import "dotenv/config";
import { Job, Worker } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

const QUEUE_NAME = "video-processing";
const JOB_NAME = "process-video";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const videoProcessingJobSchema = z.object({
  videoId: z.string(),
  s3Key: z.string(),
  userId: z.string(),
});

type VideoProcessingJob = z.infer<typeof videoProcessingJobSchema>;

const worker = new Worker<VideoProcessingJob, { status: "completed" }>(
  QUEUE_NAME,
  async (job: Job<VideoProcessingJob>) => {
    if (job.name !== JOB_NAME) {
      throw new Error(
        `Unsupported job "${job.name}" received on the "${QUEUE_NAME}" queue.`,
      );
    }

    const jobData = videoProcessingJobSchema.parse(job.data);

    console.log("Received video-processing job from producer endpoint", {
      jobId: job.id,
      jobName: job.name,
      videoId: jobData.videoId,
      s3Key: jobData.s3Key,
      userId: jobData.userId,
    });

    return { status: "completed" };
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
