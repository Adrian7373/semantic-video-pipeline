import { Worker } from "bullmq";

import { redis } from "../config/redis.js";
import { queueNames } from "../constants/queues.js";
import {
    processSocialPublish,
} from "../processors/publishing/socialPublishProcessor.js";
import type { SocialPublishJobData } from "../queues/publishingQueue.js";

export const publishingWorker = new Worker<SocialPublishJobData>(
    queueNames.publishing,
    processSocialPublish,
    { connection: redis, concurrency: 25 },
);

publishingWorker.on("completed", (job) => {
    console.log(`Publishing job ${job.id} completed.`);
});

publishingWorker.on("failed", (job, error) => {
    console.error(
        `Publishing job ${job?.id ?? "unknown"} failed.`,
        error.stack ?? error.message,
    );
});
