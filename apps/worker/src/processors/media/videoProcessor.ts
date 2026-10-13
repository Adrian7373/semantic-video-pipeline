import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import type { Job } from "bullmq";
import ffmpeg from "fluent-ffmpeg";
import { mkdir, rm, readFile } from "node:fs/promises";
import { createWriteStream, createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { execFile, execFileSync, type ExecException } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { z } from "zod";
import axios from "axios";
import FormData from "form-data";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { prisma } from "../../../../../packages/database/index.js";
import { env } from "../../config/env.js";
import { jobNames } from "../../constants/queues.js";

const s3Bucket = env.S3_BUCKET_NAME;
const LOCAL_TMP_DIR = join(process.cwd(), ".tmp");

const s3 = new S3Client({
    ...(env.AWS_REGION ? { region: env.AWS_REGION } : {}),
    maxAttempts: 5,
    requestHandler: new NodeHttpHandler({
        connectionTimeout: 30_000,
        socketTimeout: 10 * 60 * 1000,
    }),
});

const videoProcessingJobSchema = z.object({
    videoId: z.string().uuid(),
    s3Key: z.string(),
    userId: z.string().min(1),
    userPrompt: z.string().trim().max(1000).optional().nullable(),
    aspectRatio: z
        .enum(["VERTICAL_9_16", "LANDSCAPE_16_9", "SQUARE_1_1"])
        .default("VERTICAL_9_16"),
    captionStyle: z
        .enum(["NONE", "KARAOKE", "HIGHLIGHT", "MINIMAL"])
        .default("KARAOKE"),
});

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
                        thumbnail_text: z.string(),
                        start_time: z.number(),
                        end_time: z.number(),
                        key_points: z.array(z.string()).min(3).max(5),
                        quiz: z
                            .array(
                                z
                                    .object({
                                        question: z.string(),
                                        options: z.array(z.string()).length(4),
                                        answer: z.string(),
                                    })
                                    .strict(),
                            )
                            .min(3),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

type StructuredData = z.infer<typeof structuredDataSchema>;

let ffmpegExecutablePath: string | undefined;
let ffprobeExecutablePath: string | undefined;

function configureFfmpeg(): void {
    const configuredPath = env.FFMPEG_PATH;
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
    ffmpegExecutablePath = resolvedPath;

    try {
        const command = platform() === "win32" ? "where.exe" : "which";
        ffprobeExecutablePath = execFileSync(command, ["ffprobe"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        })
            .trim()
            .split(/\r?\n/)[0];
    } catch {
        throw new Error(
            "ffprobe is required to verify that the source video contains audio.",
        );
    }
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
    if (!ffmpegExecutablePath || !ffprobeExecutablePath) {
        return Promise.reject(
            new Error("FFmpeg and ffprobe executable paths are not configured."),
        );
    }

    const executablePath = ffmpegExecutablePath;
    const probeExecutablePath = ffprobeExecutablePath;

    return new Promise((resolve, reject) => {
        execFile(
            probeExecutablePath,
            [
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=index",
                "-of",
                "json",
                videoPath,
            ],
            { windowsHide: true },
            (error: ExecException | null, stdout: string, stderr: string) => {
                if (error) {
                    reject(
                        new Error(
                            `Unable to inspect audio streams: ${stderr.trim() || error.message}`,
                        ),
                    );
                    return;
                }

                let hasAudioStream = false;
                try {
                    const probeResult = JSON.parse(stdout) as {
                        streams?: Array<{ index?: number }>;
                    };
                    hasAudioStream = (probeResult.streams?.length ?? 0) > 0;
                } catch {
                    reject(new Error("ffprobe returned invalid stream metadata."));
                    return;
                }

                if (!hasAudioStream) {
                    reject(
                        new Error(
                            `The source video "${videoPath}" does not contain an audio stream. Audio extraction and transcription cannot continue.`,
                        ),
                    );
                    return;
                }

                const args = [
                    "-y",
                    "-i",
                    videoPath,
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "128k",
                    "-f",
                    "mp3",
                    audioPath,
                ];

                console.log(
                    `FFmpeg audio command: ${executablePath} ${args.join(" ")}`,
                );
                execFile(
                    executablePath,
                    args,
                    { windowsHide: true },
                    (
                        extractionError: ExecException | null,
                        _extractionStdout: string,
                        extractionStderr: string,
                    ) => {
                        if (extractionError) {
                            reject(
                                new Error(
                                    `FFmpeg audio extraction failed: ${extractionStderr.trim() || extractionError.message}`,
                                ),
                            );
                            return;
                        }

                        resolve();
                    },
                );
            },
        );
    });
}

function buildSegmentationPrompt(
    transcript: string,
    userPrompt?: string | null,
): string {
    const directive = userPrompt?.trim();
    const selectionRules = directive
        ? `The user's explicit directive is the primary filter for selecting segments: "${directive}".
Only extract segments that match this directive. Act as an expert viral video editor and instructional designer. Prioritize moments that satisfy the directive, have a natural hook at the beginning, and reach a clean resolution at the end. Prefer short-form clips between 15 and 90 seconds unless a natural thought requires slightly longer.`
        : `Identify the most engaging, high-retention thematic highlights and standalone value bombs across the video. Select moments with a natural hook at the beginning and a clean resolution at the end.`;

    return `You are an expert viral video editor and instructional designer. Analyze the timestamped transcript chunks and group them into coherent, standalone short-form video segments.

${selectionRules}

Strict timestamp rules:
1. Use the exact decimal timestamps from the transcript chunks.
2. start_time must match the first included chunk's start timestamp.
3. end_time must match the last included chunk's end timestamp.
4. Never invent, round, or extrapolate timestamps.

Content rules for every segment:
1. segment_title: Create a punchy, specific, viral-worthy clip title.
2. thumbnail_text: Create a 2 to 5 word hook in ALL CAPS designed for a high-CTR thumbnail, such as "WAIT FOR IT..." or "THE SECRET FLAW".
3. key_points: Extract 3 to 5 highly specific, actionable bullet points. Include facts, numbers, or core arguments from the transcript.
4. quiz: Generate exactly 3 multiple-choice questions testing this segment:
   - Question 1: factual recall.
   - Question 2: the underlying concept or why.
   - Question 3: inference or application.
   - Every question must have exactly 4 plausible options.

Transcript chunks:
${transcript}`;
}

function getAspectRatioFilter(aspectRatio: VideoProcessingJobData["aspectRatio"]): string {
    switch (aspectRatio) {
        case "VERTICAL_9_16":
            return "crop='min(iw,ih*(9/16))':'min(ih,iw*(16/9))',scale=1080:1920,setsar=1";
        case "SQUARE_1_1":
            return "crop='min(iw,ih)':'min(iw,ih)',scale=1080:1080,setsar=1";
        case "LANDSCAPE_16_9":
            return "crop='min(iw,ih*(16/9))':'min(ih,iw*(9/16))',scale=1920:1080,setsar=1";
    }
}

function sliceVideo(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number,
    aspectRatio: VideoProcessingJobData["aspectRatio"],
): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setStartTime(startTime)
            .setDuration(duration)
            .outputOptions([
                "-vf",
                getAspectRatioFilter(aspectRatio),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
            ])
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

export type VideoProcessingJobData = z.infer<typeof videoProcessingJobSchema>;

export async function processVideo(
    job: Job<VideoProcessingJobData>,
): Promise<{ status: "completed" }> {
        if (job.name !== jobNames.processVideo) {
            throw new Error(
                `Unsupported job "${job.name}" received by the media worker.`,
            );
        }

        const jobData = videoProcessingJobSchema.parse(job.data);
        if (!job.id) {
            throw new Error("Video-processing jobs must have a job ID.");
        }

        await mkdir(LOCAL_TMP_DIR, { recursive: true });
        const videoPath = join(LOCAL_TMP_DIR, `${job.id}.mp4`).replace(/\\/g, "/");
        const audioPath = join(LOCAL_TMP_DIR, `${job.id}.mp3`).replace(/\\/g, "/");
        const generatedClips: string[] = [];

        try {
        const parentVideo = await prisma.video.findUnique({
            where: { id: jobData.videoId },
            select: {
                userPrompt: true,
                aspectRatio: true,
                captionStyle: true,
            },
        });
        if (!parentVideo) {
            throw new Error(`Video "${jobData.videoId}" was not found.`);
        }

        const rawJobData = job.data as Record<string, unknown>;
        const effectiveJobData: VideoProcessingJobData = {
            ...jobData,
            userPrompt: jobData.userPrompt ?? parentVideo.userPrompt,
            aspectRatio:
                typeof rawJobData.aspectRatio === "string"
                    ? jobData.aspectRatio
                    : parentVideo.aspectRatio,
            captionStyle:
                typeof rawJobData.captionStyle === "string"
                    ? jobData.captionStyle
                    : parentVideo.captionStyle,
        };

        console.log("Received video-processing job from producer endpoint", {
            jobId: job.id,
            jobName: job.name,
            videoId: jobData.videoId,
            s3Key: jobData.s3Key,
            userId: jobData.userId,
            userPrompt: effectiveJobData.userPrompt,
            aspectRatio: effectiveJobData.aspectRatio,
            captionStyle: effectiveJobData.captionStyle,
        });

            await downloadS3File(jobData.s3Key, videoPath);
            await extractAudio(videoPath, audioPath);

            console.log(`Sending audio to Flask for transcription...`);

            // 1. Read the MP3 directly into memory to bypass stream deadlocks
            const audioBuffer = await readFile(audioPath);

            // 2. Attach the buffer to FormData with explicit file metadata
            const formData = new FormData();
            formData.append("file", audioBuffer, {
                filename: "audio.mp3",
                contentType: "audio/mpeg",
            });

            const contentLength = await new Promise<number>((resolve, reject) => {
                formData.getLength((error, length) => {
                    if (error) {
                        reject(
                            new Error(
                                `Unable to determine transcription upload size: ${error.message}`,
                            ),
                        );
                        return;
                    }

                    resolve(length);
                });
            });

            // 3. Send a fully sized multipart request so Flask can finish parsing it.
            const flaskUrl = env.TRANSCRIBER_URL;
            const flaskResponse = await axios.post(`${flaskUrl}/transcribe`, formData, {
                headers: {
                    ...formData.getHeaders(),
                    "Content-Length": contentLength,
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 30 * 60 * 1000,
            });

            const transcriptData = transcriptResponseSchema.parse(flaskResponse.data);
            console.log("Received transcript from Flask:", transcriptData);

            const transcript = JSON.stringify(transcriptData.segments);
            const { object: structuredData }: { object: StructuredData } =
                await generateObject({
                    model: google("gemini-3.1-flash-lite"),
                    schema: structuredDataSchema,
                    prompt: buildSegmentationPrompt(
                        transcript,
                        effectiveJobData.userPrompt,
                    ),
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
                    LOCAL_TMP_DIR,
                    `${job.id}-segment-${index}.mp4`,
                ).replace(/\\/g, "/");
                generatedClips.push(outputPath);
                await sliceVideo(
                    videoPath,
                    outputPath,
                    segment.start_time,
                    duration,
                    effectiveJobData.aspectRatio,
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
                            keyPoints: segment.key_points,
                            quiz: segment.quiz,
                            thumbnailText: segment.thumbnail_text,
                        };
                    }),
                });

                await transaction.video.update({
                    where: { id: jobData.videoId },
                    data: { status: "COMPLETED" },
                });
            });

            return { status: "completed" };
        } catch (error) {
            try {
                await prisma.video.update({
                    where: { id: jobData.videoId },
                    data: {
                        status: "FAILED",
                        errorMessage:
                            error instanceof Error ? error.message : String(error),
                    },
                });
            } catch (statusError) {
                console.error(
                    `Failed to mark video ${jobData.videoId} as FAILED.`,
                    statusError,
                );
            }

            throw error;
        } finally {
            await Promise.all([
                rm(videoPath, { force: true }),
                rm(audioPath, { force: true }),
                ...generatedClips.map((clipPath) =>
                    rm(clipPath, { force: true }),
                ),
            ]);
        }
}
