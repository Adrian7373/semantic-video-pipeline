import "dotenv/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Job, Worker } from "bullmq";
import ffmpeg from "fluent-ffmpeg";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Redis } from "ioredis";
import { z } from "zod";
import axios from "axios";
import FormData from "form-data";
import { createReadStream } from "node:fs";

const QUEUE_NAME = "video-processing";
const JOB_NAME = "process-video";
const s3Bucket = process.env.S3_BUCKET_NAME;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});

const s3 = new S3Client({
    ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
});

const videoProcessingJobSchema = z.object({
    videoId: z.string(),
    s3Key: z.string(),
    userId: z.string(),
});

type VideoProcessingJob = z.infer<typeof videoProcessingJobSchema>;

async function downloadS3File(
    s3Key: string,
    downloadPath: string,
): Promise<void> {
    if (!s3Bucket) {
        throw new Error("S3_BUCKET_NAME must be configured.");
    }

    const response = await s3.send(
        new GetObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
        }),
    );

    if (!response.Body) {
        throw new Error(`S3 object "${s3Key}" did not contain a response body.`);
    }

    await pipeline(
        Readable.from(response.Body as AsyncIterable<Uint8Array>),
        createWriteStream(downloadPath),
    );
}

function extractAudio(videoPath: string, audioPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .noVideo()
            .audioCodec("libmp3lame")
            .audioBitrate("128k")
            .format("mp3")
            .on("end", () => resolve())
            .on("error", reject)
            .save(audioPath);
    });
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

        const videoPath = `/tmp/${job.id}.mp4`;
        const audioPath = `/tmp/${job.id}.mp3`;

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

            const transcriptData = flaskResponse.data;
            console.log("Received transcript from Flask:", transcriptData);

            // Next up: send transcriptData to the LLM!
            return { status: "completed" };
        } finally {
            await Promise.all([
                rm(videoPath, { force: true }),
                rm(audioPath, { force: true }),
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
