import { prisma } from "../../../../../packages/database/index";
import VideosLibrary from "./VideosLibrary";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
    const videos = await prisma.video.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { segments: true } } },
    });

    return <VideosLibrary initialVideos={videos} />;
}
