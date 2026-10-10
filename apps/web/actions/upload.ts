"use server";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const allowedVideoTypes = ["video/mp4", "video/quicktime", "video/webm"] as const;

const uploadMetadataSchema = z.object({
    filename: z.string().trim().min(1, "A filename is required."),
    contentType: z.enum(allowedVideoTypes, {
        error: "Unsupported video type.",
    }),
    fileSize: z
        .number()
        .finite()
        .int()
        .nonnegative()
        .max(MAX_FILE_SIZE, "Video files must not exceed 2 GB."),
});

export interface UploadMetadata {
    filename: string;
    contentType: string;
    fileSize: number;
}

export interface PresignedUpload {
    success: true;
    uploadUrl: string;
    s3Key: string;
}

const s3 = new S3Client({
    region: process.env.AWS_REGION,
});

export async function getPresignedUploadUrl(
    metadata: UploadMetadata,
    s3Key: string,
): Promise<PresignedUpload> {
    const parsedMetadata = uploadMetadataSchema.parse(metadata);
    const parsedS3Key = z
        .string()
        .regex(/^raw-videos\/[0-9a-f-]{36}-[a-zA-Z0-9._-]+$/i, "Invalid S3 key.")
        .parse(s3Key);
    const bucket = process.env.S3_BUCKET_NAME;
    const region = process.env.AWS_REGION;

    if (!bucket || !region) {
        throw new Error("AWS_REGION and S3_BUCKET_NAME must be configured.");
    }
    const safeFilename = parsedMetadata.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: parsedS3Key,
        ContentType: parsedMetadata.contentType,
        ContentLength: parsedMetadata.fileSize,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    return {
        success: true,
        uploadUrl,
        s3Key: parsedS3Key,
    };
}

export const createUploadUrl = getPresignedUploadUrl;
