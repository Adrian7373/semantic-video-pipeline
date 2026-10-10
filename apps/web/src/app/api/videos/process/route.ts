import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getVideoProcessingQueue,
  type VideoProcessingJobData,
} from "@/../lib/queue";
import { prisma } from "../../../../../../../packages/database/index";

export const dynamic = "force-dynamic";

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
    const video = await prisma.video.findUnique({
      where: { id: jobData.videoId },
      select: { id: true, s3Key: true, userId: true, status: true },
    });

    if (
      !video ||
      video.s3Key !== jobData.s3Key ||
      video.userId !== jobData.userId ||
      video.status !== "UPLOADING"
    ) {
      return NextResponse.json(
        { error: "Video upload session is invalid or already processed." },
        { status: 409 },
      );
    }

    await prisma.video.update({
      where: { id: jobData.videoId },
      data: { status: "PROCESSING" },
    });

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
    await prisma.video
      .update({
        where: { id: jobData.videoId },
        data: { status: "FAILED" },
      })
      .catch((statusError: unknown) => {
        console.error("Failed to mark video upload as failed.", statusError);
      });

    return NextResponse.json(
      { error: "Unable to queue video processing." },
      { status: 503 },
    );
  }
}
