import { NextResponse } from "next/server";
import { prisma } from "../../../../../../../packages/database/index";
import { getSignedDownloadUrl } from "@/lib/s3";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
    const { id } = await context.params;

    try {
        const video = await prisma.video.findUnique({
            where: { id },
            include: {
                segments: {
                    orderBy: { startTime: "asc" },
                    include: {
                        scheduledPosts: {
                            include: {
                                socialAccount: {
                                    select: {
                                        id: true,
                                        platform: true,
                                        accountName: true,
                                        platformAccountId: true,
                                    },
                                },
                            },
                            orderBy: { scheduledFor: "asc" },
                        },
                    },
                },
            },
        });

        if (!video) {
            return NextResponse.json({ error: "Video not found." }, { status: 404 });
        }

        const segments = await Promise.all(
            video.segments.map(async (segment) => ({
                ...segment,
                clipUrl: await getSignedDownloadUrl(segment.clipS3Key),
                captionedClipUrl: await getSignedDownloadUrl(segment.captionedClipS3Key),
                thumbnailUrl: await getSignedDownloadUrl(segment.thumbnailS3Key),
            })),
        );

        return NextResponse.json({ ...video, segments });
    } catch (error) {
        console.error(`Failed to fetch video ${id}.`, error);
        return NextResponse.json(
            { error: "Unable to load video." },
            { status: 503 },
        );
    }
}
