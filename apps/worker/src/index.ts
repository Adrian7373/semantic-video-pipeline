import "dotenv/config";
import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { Job, Worker } from "bullmq";
import ffmpeg from "fluent-ffmpeg";
import { mkdir, rm } from "node:fs/promises";
import { createWriteStream, createReadStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { platform } from "node:os";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Redis } from "ioredis";
import { z } from "zod";
import axios from "axios";
import FormData from "form-data";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { prisma } from "../../../packages/database/index.js";

const QUEUE_NAME = "video-processing";
const JOB_NAME = "process-video";
const s3Bucket = process.env.S3_BUCKET_NAME;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});

const s3 = new S3Client({
    ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
    maxAttempts: 5,
    requestHandler: new NodeHttpHandler({
        connectionTimeout: 30_000,
        socketTimeout: 10 * 60 * 1000,
    }),
});

const videoProcessingJobSchema = z.object({
    videoId: z.string(),
    s3Key: z.string(),
    userId: z.string(),
});

type VideoProcessingJob = z.infer<typeof videoProcessingJobSchema>;

const transcriptSegmentSchema = z
    .object({
        start: z.number(),
        end: z.number(),
        text: z.string(),
    })
    .strict();

const transcriptResponseSchema = z
    .object({
        segments: z.array(transcriptSegmentSchema),
        language: z.string(),
    })
    .strict();

const structuredDataSchema = z
    .object({
        segments: z
            .array(
                z
                    .object({
                        segment_title: z.string(),
                        start_time: z.number(),
                        end_time: z.number(),
                        summary: z.string(),
                        quiz: z
                            .array(
                                z
                                    .object({
                                        question: z.string(),
                                        options: z.array(z.string()),
                                        answer: z.string(),
                                    })
                                    .strict(),
                            )
                            .min(1),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

type StructuredData = z.infer<typeof structuredDataSchema>;

function configureFfmpeg(): void {
    const configuredPath = process.env.FFMPEG_PATH;
    const standardPaths =
        platform() === "win32"
            ? [
                "C:\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
            ]
            : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
    const executablePath =
        configuredPath ??
        standardPaths.find((candidate) => existsSync(candidate));
    const pathExecutable = (() => {
        try {
            const command = platform() === "win32" ? "where.exe" : "which";
            return execFileSync(command, ["ffmpeg"], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            })
                .trim()
                .split(/\r?\n/)[0];
        } catch {
            return undefined;
        }
    })();

    if (configuredPath && !existsSync(configuredPath)) {
        throw new Error(`FFMPEG_PATH does not exist: "${configuredPath}".`);
    }

    const resolvedPath = executablePath ?? pathExecutable;
    if (!resolvedPath) {
        throw new Error(
            "FFmpeg is required but was not found. Install FFmpeg or set FFMPEG_PATH to the executable path.",
        );
    }

    ffmpeg.setFfmpegPath(resolvedPath);
}

configureFfmpeg();

async function downloadS3File(
    s3Key: string,
    downloadPath: string,
): Promise<void> {
    if (!s3Bucket) {
        throw new Error("S3_BUCKET_NAME must be configured.");
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
        abortController.abort(
            new Error(`Timed out downloading S3 object "${s3Key}".`),
        );
    }, 10 * 60 * 1000);

    try {
        console.log(`Downloading S3 object "${s3Key}"...`);
        const response = await s3.send(
            new GetObjectCommand({
                Bucket: s3Bucket,
                Key: s3Key,
            }),
            { abortSignal: abortController.signal },
        );

        if (!response.Body) {
            throw new Error(`S3 object "${s3Key}" did not contain a response body.`);
        }

        console.log(
            `S3 headers received${response.ContentLength === undefined ? "." : ` (${response.ContentLength} bytes).`}`,
        );
        const bodyStream = Readable.fromWeb(
            response.Body.transformToWebStream() as unknown as NodeReadableStream<Uint8Array>,
        );
        await pipeline(bodyStream, createWriteStream(downloadPath));
        console.log(`Saved S3 object to "${downloadPath}".`);
    } catch (error) {
        await rm(downloadPath, { force: true });
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function extractAudio(videoPath: string, audioPath: string): Promise<void> {
    console.log("Extracting audio...");
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .noVideo() // Equivalent to -vn
            .audioCodec("libmp3lame") // Equivalent to -c:a libmp3lame
            .audioBitrate("128k") // Equivalent to -b:a 128k
            .format("mp3") // Equivalent to -f mp3
            .on("start", (commandLine) => {
                console.log(`FFmpeg audio command: ${commandLine}`);
            })
            .on("end", () => resolve())
            .on("error", (error) => reject(error))
            .save(audioPath); // fluent-ffmpeg automatically handles the -y overwrite flag
    });
}

function sliceVideo(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setStartTime(startTime)
            .setDuration(duration)
            .outputOptions(["-c", "copy"])
            .on("end", () => resolve())
            .on("error", reject)
            .save(outputPath);
    });
}

async function uploadS3File(localPath: string, s3Key: string): Promise<void> {
    if (!s3Bucket) {
        throw new Error("S3_BUCKET_NAME must be configured.");
    }

    await s3.send(
        new PutObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
            Body: createReadStream(localPath),
            ContentType: "video/mp4",
        }),
    );
}

const worker = new Worker<VideoProcessingJob, { status: "completed" }>(
    QUEUE_NAME,
    async (job: Job<VideoProcessingJob>) => {
        if (job.name !== JOB_NAME) {
            throw new Error(
                `Unsupported job "${job.name}" received on the "${QUEUE_NAME}" queue.`,
            );
        }

        const jobData = videoProcessingJobSchema.parse(job.data);
        if (!job.id) {
            throw new Error("Video-processing jobs must have a job ID.");
        }

        const videoPath = join(tmpdir(), `${job.id}.mp4`);
        const audioPath = join(tmpdir(), `${job.id}.mp3`);
        const generatedClips: string[] = [];

        console.log("Received video-processing job from producer endpoint", {
            jobId: job.id,
            jobName: job.name,
            videoId: jobData.videoId,
            s3Key: jobData.s3Key,
            userId: jobData.userId,
        });

        try {
            await downloadS3File(jobData.s3Key, videoPath);
            await extractAudio(videoPath, audioPath);

            console.log(`Sending audio to Flask for transcription...`);

            // 1. Create a FormData instance and attach the audio file stream
            const formData = new FormData();
            formData.append("file", createReadStream(audioPath));

            // 2. Send the POST request to your Flask microservice
            const flaskUrl = process.env.TRANSCRIBER_URL ?? "http://127.0.0.1:5001";
            const flaskResponse = await axios.post(`${flaskUrl}/transcribe`, formData, {
                headers: formData.getHeaders(),
                // Transcriptions take time, so give Axios a generous timeout (e.g., 5 minutes)
                timeout: 300000,
            });

            const transcriptData = transcriptResponseSchema.parse(flaskResponse.data);
            console.log("Received transcript from Flask:", transcriptData);

            const transcript = JSON.stringify(transcriptData.segments);
            const { object: structuredData }: { object: StructuredData } =
                await generateObject({
                    model: google("gemini-3.1-flash-lite"),
                    schema: structuredDataSchema,
                    prompt: `Group the following timestamped transcript chunks into coherent thematic video segments.

Use the exact decimal timestamps from the transcript chunks for each segment's start_time and end_time. Each segment must begin at the start timestamp of its first included chunk and end at the end timestamp of its last included chunk. Do not invent, round, or alter timestamps. Give each segment a concise title and summary. Create at least one quiz question per segment, with answer options and the correct answer.

Transcript chunks:
${transcript}`,
                });

            console.log("Parsed structured transcript data:", structuredData);

            for (const [index, segment] of structuredData.segments.entries()) {
                const duration = segment.end_time - segment.start_time;
                if (duration <= 0) {
                    throw new Error(
                        `Invalid duration for segment ${index}: ${segment.start_time} to ${segment.end_time}.`,
                    );
                }

                const outputPath = join(
                    tmpdir(),
                    `${job.id}-segment-${index}.mp4`,
                );
                generatedClips.push(outputPath);
                await sliceVideo(
                    videoPath,
                    outputPath,
                    segment.start_time,
                    duration,
                );
            }

            for (const [index, segment] of structuredData.segments.entries()) {
                const localClipPath = generatedClips[index];
                if (!localClipPath) {
                    throw new Error(
                        `Missing local clip for segment ${index}.`,
                    );
                }

                const clipS3Key = `processed-videos/${job.id}-segment-${index}.mp4`;
                await uploadS3File(localClipPath, clipS3Key);
            }

            await prisma.$transaction(async (transaction) => {
                await transaction.videoSegment.createMany({
                    data: structuredData.segments.map((segment, index) => {
                        const clipS3Key = `processed-videos/${job.id}-segment-${index}.mp4`;

                        return {
                            videoId: jobData.videoId,
                            clipS3Key,
                            startTime: String(segment.start_time),
                            endTime: String(segment.end_time),
                            title: segment.segment_title,
                            summary: segment.summary,
                            quiz: segment.quiz,
                        };
                    }),
                });

                await transaction.video.update({
                    where: { id: jobData.videoId },
                    data: { status: "COMPLETED" },
                });
            });

            return { status: "completed" };
        } finally {
            await Promise.all([
                rm(videoPath, { force: true }),
                rm(audioPath, { force: true }),
                ...generatedClips.map((clipPath) =>
                    rm(clipPath, { force: true }),
                ),
            ]);
        }
    },
    { connection: redis },
);

worker.on("completed", (job) => {
    console.log(`Video-processing job ${job.id} completed.`);
});

worker.on("failed", (job, error) => {
    console.error(`Video-processing job ${job?.id ?? "unknown"} failed.`, error);
});

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}; shutting down worker.`);

    await worker.close();
    await redis.quit();
};

process.once("SIGINT", () => {
    void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
});

console.log(
    `Worker listening for "${JOB_NAME}" jobs on the "${QUEUE_NAME}" queue.`,
);
