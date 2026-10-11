import { Queue } from "bullmq";

import { redis } from "../config/redis.js";
import { queueNames } from "../constants/queues.js";
import type { VideoProcessingJobData } from "../processors/media/videoProcessor.js";

export const mediaQueue = new Queue<VideoProcessingJobData>(queueNames.media, {
    connection: redis,
});
