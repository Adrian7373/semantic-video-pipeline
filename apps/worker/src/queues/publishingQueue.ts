import { Queue } from "bullmq";

import { redis } from "../config/redis.js";
import { queueNames } from "../constants/queues.js";

export interface SocialPublishJobData {
    videoId: string;
    segmentId?: string;
    platform: string;
}

export const publishingQueue = new Queue<SocialPublishJobData>(
    queueNames.publishing,
    { connection: redis },
);
