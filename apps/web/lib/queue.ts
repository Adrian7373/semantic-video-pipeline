import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const videoProcessingQueueName = "video-processing";

export interface VideoProcessingJobData {
  videoId: string;
  s3Key: string;
  userId: string;
}

const globalForQueue = globalThis as unknown as {
  redis: Redis | undefined;
  videoProcessingQueue: Queue<VideoProcessingJobData> | undefined;
};

export function getVideoProcessingQueue(): Queue<VideoProcessingJobData> {
  if (globalForQueue.videoProcessingQueue) {
    return globalForQueue.videoProcessingQueue;
  }

  const redis =
    globalForQueue.redis ??
    new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
  const queue = new Queue<VideoProcessingJobData>(videoProcessingQueueName, {
    connection: redis,
  });

  globalForQueue.redis = redis;
  globalForQueue.videoProcessingQueue = queue;

  return queue;
}
