import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../../../packages/database/index";

export const dynamic = "force-dynamic";

const initializeVideoSchema = z.object({
    filename: z.string().trim().min(1),
    contentType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
    fileSize: z.number().finite().int().nonnegative(),
    userId: z.string().uuid(),
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

    const parsedBody = initializeVideoSchema.safeParse(body);
    if (!parsedBody.success) {
        return NextResponse.json(
            { error: "filename, contentType, fileSize, and userId are required." },
            { status: 400 },
        );
    }

    const { filename, userId } = parsedBody.data;
    const videoId = crypto.randomUUID();
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const s3Key = `raw-videos/${videoId}-${safeFilename}`;

    try {
        await prisma.video.create({
            data: {
                id: videoId,
                userId,
                title: filename,
                s3Key,
                status: "UPLOADING",
            },
        });

        return NextResponse.json({ videoId, s3Key }, { status: 201 });
    } catch (error) {
        console.error("Failed to initialize video upload.", error);
        return NextResponse.json(
            { error: "Unable to initialize video upload." },
            { status: 503 },
        );
    }
}
