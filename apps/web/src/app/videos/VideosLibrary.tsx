"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type VideoCard = {
    id: string;
    title: string;
    status: "UPLOADING" | "PROCESSING" | "COMPLETED" | "FAILED";
    userPrompt: string | null;
    aspectRatio: string;
    captionStyle: string;
    errorMessage: string | null;
    createdAt: Date;
    _count: { segments: number };
};

const statusStyles: Record<VideoCard["status"], string> = {
    UPLOADING: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    PROCESSING: "border-blue-400/20 bg-blue-400/10 text-blue-300",
    COMPLETED: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    FAILED: "border-red-400/20 bg-red-400/10 text-red-300",
};

export default function VideosLibrary({ initialVideos }: { initialVideos: VideoCard[] }) {
    const router = useRouter();
    const [videos, setVideos] = useState(initialVideos);
    const [retrying, setRetrying] = useState<string | null>(null);

    useEffect(() => setVideos(initialVideos), [initialVideos]);

    useEffect(() => {
        if (!videos.some((video) => video.status === "UPLOADING" || video.status === "PROCESSING")) {
            return;
        }
        const interval = window.setInterval(() => router.refresh(), 4000);
        return () => window.clearInterval(interval);
    }, [router, videos]);

    async function retry(videoId: string) {
        setRetrying(videoId);
        try {
            const response = await fetch(`/api/videos/${videoId}/retry`, { method: "POST" });
            if (!response.ok) throw new Error("Retry failed.");
            router.refresh();
        } catch (error) {
            console.error("Unable to retry video.", error);
        } finally {
            setRetrying(null);
        }
    }

    return (
        <main className="min-h-screen bg-[#121214] px-6 py-10 text-zinc-100 sm:px-10">
            <div className="mx-auto max-w-7xl">
                <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">Semantic studio</p>
                        <h1 className="text-3xl font-semibold tracking-tight">Video library</h1>
                        <p className="mt-2 text-sm text-zinc-500">Monitor processing and open your clips for review.</p>
                    </div>
                    <a href="/" className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white">
                        Upload video
                    </a>
                </div>

                {videos.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-800 bg-[#18181b] p-16 text-center text-zinc-500">
                        No videos yet. Upload your first video to begin.
                    </div>
                ) : (
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {videos.map((video) => (
                            <article key={video.id} className="rounded-2xl border border-zinc-800 bg-[#18181b] p-5 shadow-2xl shadow-black/10">
                                <div className="mb-6 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h2 className="truncate font-medium">{video.title}</h2>
                                        <p className="mt-1 text-xs text-zinc-600">{new Date(video.createdAt).toLocaleDateString()}</p>
                                    </div>
                                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide ${statusStyles[video.status]}`}>
                                        {video.status}
                                    </span>
                                </div>
                                <div className="mb-5 flex flex-wrap gap-2 text-[11px] text-zinc-400">
                                    <span className="rounded-full bg-zinc-900 px-2.5 py-1">{video.aspectRatio.replace("_", " ")}</span>
                                    <span className="rounded-full bg-zinc-900 px-2.5 py-1">{video.captionStyle}</span>
                                    <span className="rounded-full bg-zinc-900 px-2.5 py-1">{video._count.segments} segments</span>
                                </div>
                                <p className="mb-6 h-10 text-sm leading-5 text-zinc-500">
                                    {video.userPrompt ? video.userPrompt.slice(0, 100) : "Automatic high-retention highlight extraction"}
                                </p>
                                {video.status === "FAILED" && (
                                    <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300" title={video.errorMessage ?? undefined}>
                                        {video.errorMessage ?? "Processing failed."}
                                    </div>
                                )}
                                {video.status === "FAILED" ? (
                                    <button onClick={() => retry(video.id)} disabled={retrying === video.id} className="w-full rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50">
                                        {retrying === video.id ? "Retrying..." : "Retry processing"}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => video.status === "COMPLETED" && router.push(`/videos/${video.id}`)}
                                        disabled={video.status !== "COMPLETED"}
                                        className="w-full rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-default disabled:border-zinc-800 disabled:text-zinc-600"
                                    >
                                        {video.status === "COMPLETED" ? "Open semantic studio" : "Processing in background"}
                                    </button>
                                )}
                            </article>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
