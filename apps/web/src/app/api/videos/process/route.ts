import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getVideoProcessingQueue,
  type VideoProcessingJobData,
} from "@/../lib/queue";

const videoProcessingJobSchema = z.object({
  s3Key: z.string().min(1),
  videoId: z.string().min(1),
  userId: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsedBody = videoProcessingJobSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "s3Key, videoId, and userId are required." },
      { status: 400 },
    );
  }

  const jobData: VideoProcessingJobData = parsedBody.data;
  try {
    const job = await getVideoProcessingQueue().add("process-video", jobData);

    return NextResponse.json(
      {
        jobId: job.id,
        queued: true,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Failed to enqueue video-processing job.", error);

    return NextResponse.json(
      { error: "Unable to queue video processing." },
      { status: 503 },
    );
  }
}
