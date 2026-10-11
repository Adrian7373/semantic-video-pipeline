import type { Job } from "bullmq";

export async function processCaption(_job: Job): Promise<void> {
    throw new Error("Caption processing is not implemented yet.");
}
