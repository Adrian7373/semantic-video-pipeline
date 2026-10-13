import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
    region: process.env.AWS_REGION,
});

export async function getSignedDownloadUrl(
    s3Key: string | null | undefined,
    expiresIn = 3600,
): Promise<string | null> {
    if (!s3Key) {
        return null;
    }

    const bucket = process.env.S3_BUCKET_NAME;
    const region = process.env.AWS_REGION;
    if (!bucket || !region) {
        throw new Error("AWS_REGION and S3_BUCKET_NAME must be configured.");
    }

    return getSignedUrl(
        s3,
        new GetObjectCommand({
            Bucket: bucket,
            Key: s3Key,
        }),
        { expiresIn },
    );
}
