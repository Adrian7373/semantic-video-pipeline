import type { Job } from "bullmq";

export async function processThumbnail(_job: Job): Promise<void> {
    throw new Error("Thumbnail processing is not implemented yet.");
}
