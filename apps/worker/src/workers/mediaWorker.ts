import { Worker, type Job } from "bullmq";

import { redis } from "../config/redis.js";
import { queueNames } from "../constants/queues.js";
import {
    processVideo,
    type VideoProcessingJobData,
} from "../processors/media/videoProcessor.js";
import { processCaption } from "../processors/media/captionProcessor.js";
import { processThumbnail } from "../processors/media/thumbnailProcessor.js";
import { jobNames } from "../constants/queues.js";

const processMediaJob = async (job: Job<VideoProcessingJobData>) => {
    switch (job.name) {
        case jobNames.processVideo:
            return processVideo(job);
        case jobNames.createCaption:
            return processCaption(job);
        case jobNames.createThumbnail:
            return processThumbnail(job);
        default:
            throw new Error(`Unsupported media job "${job.name}".`);
    }
};

export const mediaWorker = new Worker<VideoProcessingJobData, unknown>(
    queueNames.media,
    processMediaJob,
    {
    connection: redis,
    concurrency: 2,
    },
);

// Keep consuming the queue used by the existing web producer while clients migrate.
export const legacyVideoWorker = new Worker<VideoProcessingJobData, unknown>(
    queueNames.legacyVideo,
    processMediaJob,
    {
    connection: redis,
    concurrency: 2,
    },
);

for (const worker of [mediaWorker, legacyVideoWorker]) {
    worker.on("completed", (job) => {
        console.log(`Media job ${job.id} completed.`);
    });
    worker.on("failed", (job, error) => {
        console.error(
            `Media job ${job?.id ?? "unknown"} failed.`,
            error.stack ?? error.message,
        );
    });
}
