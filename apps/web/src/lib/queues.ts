import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const PROCESS_VIDEO_JOB = "process-video";
export const PUBLISH_SOCIAL_POST_JOB = "publish-social-post";

export const MEDIA_PROCESSING_QUEUE = "media-processing";
export const SOCIAL_PUBLISHING_QUEUE = "social-publishing";

export type AspectRatio =
    | "VERTICAL_9_16"
    | "LANDSCAPE_16_9"
    | "SQUARE_1_1";

export type CaptionStyle = "NONE" | "KARAOKE" | "HIGHLIGHT" | "MINIMAL";

export interface MediaProcessingJobData {
    videoId: string;
    s3Key: string;
    userId: string;
    userPrompt?: string;
    aspectRatio: AspectRatio;
    captionStyle: CaptionStyle;
}

export interface SocialPublishingJobData {
    scheduledPostId: string;
}

const globalForQueues = globalThis as unknown as {
    redis: Redis | undefined;
    mediaProcessingQueue: Queue<MediaProcessingJobData> | undefined;
    socialPublishingQueue: Queue<SocialPublishingJobData> | undefined;
};

const redis =
    globalForQueues.redis ??
    new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        maxRetriesPerRequest: null,
    });

export const mediaProcessingQueue =
    globalForQueues.mediaProcessingQueue ??
    new Queue<MediaProcessingJobData>(MEDIA_PROCESSING_QUEUE, {
        connection: redis,
    });

export const socialPublishingQueue =
    globalForQueues.socialPublishingQueue ??
    new Queue<SocialPublishingJobData>(SOCIAL_PUBLISHING_QUEUE, {
        connection: redis,
    });

if (process.env.NODE_ENV !== "production") {
    globalForQueues.redis = redis;
    globalForQueues.mediaProcessingQueue = mediaProcessingQueue;
    globalForQueues.socialPublishingQueue = socialPublishingQueue;
}
