import { NextResponse } from "next/server";
import { prisma } from "../../../../../../../../packages/database/index";
import {
    mediaProcessingQueue,
    PROCESS_VIDEO_JOB,
    type MediaProcessingJobData,
} from "@/lib/queues";

export const dynamic = "force-dynamic";

export async function POST(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params;

    try {
        const video = await prisma.video.findUnique({ where: { id } });
        if (!video) {
            return NextResponse.json({ error: "Video not found." }, { status: 404 });
        }
        if (video.status !== "FAILED") {
            return NextResponse.json({ error: "Only failed videos can be retried." }, { status: 409 });
        }

        const payload: MediaProcessingJobData = {
            videoId: video.id,
            s3Key: video.s3Key,
            userId: video.userId,
            userPrompt: video.userPrompt,
            aspectRatio: video.aspectRatio,
            captionStyle: video.captionStyle,
        };

        await prisma.video.update({
            where: { id },
            data: { status: "PROCESSING", errorMessage: null },
        });
        const job = await mediaProcessingQueue.add(PROCESS_VIDEO_JOB, payload, {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: 100,
        });

        return NextResponse.json({ queued: true, jobId: job.id }, { status: 202 });
    } catch (error) {
        console.error(`Failed to retry video ${id}.`, error);
        await prisma.video.update({
            where: { id },
            data: {
                status: "FAILED",
                errorMessage: error instanceof Error ? error.message : String(error),
            },
        }).catch((statusError: unknown) => console.error("Failed to persist retry error.", statusError));
        return NextResponse.json({ error: "Unable to retry video." }, { status: 503 });
    }
}
