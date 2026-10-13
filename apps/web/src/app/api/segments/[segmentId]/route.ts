import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../../../packages/database/index";

export const dynamic = "force-dynamic";

const segmentUpdateSchema = z
    .object({
        title: z.string().trim().min(1).max(200).optional(),
        thumbnailText: z.string().trim().max(100).optional().nullable(),
        keyPoints: z.array(z.string().trim().min(1).max(500)).min(1).max(10).optional(),
        socialCaption: z.string().trim().max(3000).optional().nullable(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field is required.",
    });

export async function PATCH(
    request: Request,
    context: { params: Promise<{ segmentId: string }> },
) {
    const { segmentId } = await context.params;
    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const parsed = segmentUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid segment update." }, { status: 400 });
    }

    try {
        const segment = await prisma.videoSegment.update({
            where: { id: segmentId },
            data: parsed.data,
        });
        return NextResponse.json(segment);
    } catch (error) {
        console.error(`Failed to update segment ${segmentId}.`, error);
        return NextResponse.json({ error: "Unable to update segment." }, { status: 503 });
    }
}
