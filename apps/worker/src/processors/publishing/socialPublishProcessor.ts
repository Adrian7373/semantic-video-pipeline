import type { Job } from "bullmq";

export async function processSocialPublish(_job: Job): Promise<void> {
    throw new Error("Social publishing is not implemented yet.");
}
