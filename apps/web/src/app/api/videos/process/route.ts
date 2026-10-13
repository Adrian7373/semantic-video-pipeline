import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AspectRatio,
  CaptionStyle,
  prisma,
} from "../../../../../../../packages/database/index";
import {
  mediaProcessingQueue,
  PROCESS_VIDEO_JOB,
  type MediaProcessingJobData,
} from "@/lib/queues";

export const dynamic = "force-dynamic";

const videoProcessingJobSchema = z.object({
  s3Key: z.string().min(1),
  videoId: z.string().uuid(),
  userId: z.string().min(1),
  userPrompt: z.string().trim().max(1000).optional(),
  aspectRatio: z.nativeEnum(AspectRatio).optional(),
  captionStyle: z.nativeEnum(CaptionStyle).optional(),
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

  const requestData = parsedBody.data;
  try {
    const video = await prisma.video.findUnique({
      where: { id: requestData.videoId },
      select: {
        id: true,
        s3Key: true,
        userId: true,
        status: true,
        userPrompt: true,
        aspectRatio: true,
        captionStyle: true,
      },
    });

    if (
      !video ||
      video.s3Key !== requestData.s3Key ||
      video.userId !== requestData.userId ||
      video.status !== "UPLOADING"
    ) {
      return NextResponse.json(
        { error: "Video upload session is invalid or already processed." },
        { status: 409 },
      );
    }

    const jobData: MediaProcessingJobData = {
      videoId: video.id,
      s3Key: video.s3Key,
      userId: video.userId,
      userPrompt: requestData.userPrompt ?? video.userPrompt ?? undefined,
      aspectRatio: requestData.aspectRatio ?? video.aspectRatio,
      captionStyle: requestData.captionStyle ?? video.captionStyle,
    };

    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: "PROCESSING",
        errorMessage: null,
        ...(requestData.userPrompt !== undefined ||
        requestData.aspectRatio !== undefined ||
        requestData.captionStyle !== undefined
          ? {
              userPrompt: jobData.userPrompt ?? null,
              aspectRatio: jobData.aspectRatio,
              captionStyle: jobData.captionStyle,
            }
          : {}),
      },
    });

    const job = await mediaProcessingQueue.add(PROCESS_VIDEO_JOB, jobData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
    });

    return NextResponse.json(
      {
        jobId: job.id,
        queued: true,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Failed to enqueue media-processing job.", error);
    await prisma.video
      .update({
        where: { id: requestData.videoId },
        data: {
          status: "FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Unable to queue video processing.",
        },
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
