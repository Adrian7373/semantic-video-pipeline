import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    S3_BUCKET_NAME: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),
    FFMPEG_PATH: z.string().min(1).optional(),
    TRANSCRIBER_URL: z.string().url().default("http://127.0.0.1:5001"),
});

export const env = envSchema.parse(process.env);
