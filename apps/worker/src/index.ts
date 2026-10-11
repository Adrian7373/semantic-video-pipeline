import { redis } from "./config/redis.js";
import { mediaWorker, legacyVideoWorker } from "./workers/mediaWorker.js";
import { publishingWorker } from "./workers/publishingWorker.js";

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}; shutting down workers.`);

    await Promise.all([
        mediaWorker.close(),
        legacyVideoWorker.close(),
        publishingWorker.close(),
    ]);
    await redis.quit();
};

process.once("SIGINT", () => {
    void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
});

console.log(
    "Worker listening on media-processing, video-processing, and publishing queues.",
);
