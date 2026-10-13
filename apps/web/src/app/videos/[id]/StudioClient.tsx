"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

const quizSchema = z.array(z.object({
    question: z.string(),
    options: z.array(z.string()).length(4),
    answer: z.string(),
}).strict()).min(1);
type QuizQuestion = z.infer<typeof quizSchema>[number];

type Segment = {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    keyPoints: string[];
    thumbnailText: string | null;
    quiz: unknown;
    clipUrl: string | null;
    captionedClipUrl: string | null;
    scheduledPosts: Array<{
        id: string;
        status: string;
        scheduledFor: string;
        caption: string;
        socialAccount: { platform: string; accountName: string };
    }>;
};

type Video = {
    id: string;
    title: string;
    status: "UPLOADING" | "PROCESSING" | "COMPLETED" | "FAILED";
    aspectRatio: "VERTICAL_9_16" | "LANDSCAPE_16_9" | "SQUARE_1_1";
    segments: Segment[];
};

function seconds(value: string) {
    const parts = value.split(":").map(Number);
    if (parts.some(Number.isNaN)) return 0;
    return parts.length === 2 ? parts[0] * 60 + parts[1] : Number(value);
}

function timestamp(value: string) {
    const total = Math.max(0, Math.round(seconds(value)));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function duration(segment: Segment) {
    return Math.max(0, seconds(segment.endTime) - seconds(segment.startTime));
}

const aspectClasses = {
    VERTICAL_9_16: "aspect-[9/16] max-h-[62vh]",
    SQUARE_1_1: "aspect-square max-w-[62vh]",
    LANDSCAPE_16_9: "aspect-video w-full",
};

export default function StudioClient({ videoId }: { videoId: string }) {
    const [video, setVideo] = useState<Video | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [captioned, setCaptioned] = useState(false);
    const [tab, setTab] = useState<"insights" | "quiz" | "schedule">("insights");
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const response = await fetch(`/api/videos/${videoId}`, { cache: "no-store" });
            if (!response.ok) throw new Error("Unable to load video.");
            const data = (await response.json()) as Video;
            setVideo(data);
            setActiveId((current) => current ?? data.segments[0]?.id ?? null);
            setError(null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Unable to load video.");
        } finally {
            setLoading(false);
        }
    }, [videoId]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        if (!video || (video.status !== "PROCESSING" && video.status !== "UPLOADING")) return;
        const interval = window.setInterval(() => void load(), 4000);
        return () => window.clearInterval(interval);
    }, [load, video]);

    const active = useMemo(
        () => video?.segments.find((segment) => segment.id === activeId) ?? video?.segments[0],
        [activeId, video],
    );

    if (loading) return <StudioSkeleton />;
    if (error || !video) return <div className="min-h-screen bg-[#121214] p-10 text-red-300">{error ?? "Video not found."}</div>;
    if (video.status !== "COMPLETED") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#121214] px-6 text-center text-zinc-100">
                <div><div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-400" />
                    <h1 className="text-xl font-medium">Your semantic studio is preparing</h1>
                    <p className="mt-2 text-sm text-zinc-500">Live status: {video.status}. This page updates automatically.</p>
                </div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-[#121214] text-zinc-100">
            <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                <div><a href="/videos" className="text-xs text-zinc-500 hover:text-zinc-200">← Video library</a><h1 className="mt-1 text-lg font-semibold">{video.title}</h1></div>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">COMPLETED</span>
            </header>
            <div className="grid min-h-[calc(100vh-81px)] lg:grid-cols-[280px_minmax(0,1fr)_340px]">
                <aside className="border-b border-zinc-800 p-4 lg:border-b-0 lg:border-r">
                    <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Segments · {video.segments.length}</h2>
                    <div className="space-y-2 lg:max-h-[calc(100vh-130px)] lg:overflow-y-auto">
                        {video.segments.map((segment, index) => (
                            <button key={segment.id} onClick={() => setActiveId(segment.id)} className={`w-full rounded-xl border p-3 text-left transition ${active?.id === segment.id ? "border-blue-400/50 bg-blue-400/10" : "border-zinc-800 bg-[#18181b] hover:border-zinc-700"}`}>
                                <div className="flex items-center justify-between text-[10px] text-zinc-500"><span>#{String(index + 1).padStart(2, "0")}</span><span>{timestamp(segment.startTime)} - {timestamp(segment.endTime)}</span></div>
                                <p className="mt-2 line-clamp-2 text-sm text-zinc-200">{segment.title}</p>
                                <span className="mt-2 inline-block rounded-full bg-zinc-900 px-2 py-1 text-[10px] text-zinc-500">{Math.round(duration(segment))}s · {segment.scheduledPosts.length ? "Scheduled" : "Unscheduled"}</span>
                            </button>
                        ))}
                    </div>
                </aside>
                <section className="flex flex-col items-center border-b border-zinc-800 p-6 lg:border-b-0 lg:border-r lg:p-10">
                    {active && <Workspace segment={active} captioned={captioned} setCaptioned={setCaptioned} aspectRatio={video.aspectRatio} onSchedule={() => setScheduleOpen(true)} />}
                </section>
                <InsightsPanel segment={active} tab={tab} setTab={setTab} onSaved={load} />
            </div>
            {active && scheduleOpen && <ScheduleModal segment={active} onClose={() => setScheduleOpen(false)} />}
        </main>
    );
}

function Workspace({ segment, captioned, setCaptioned, aspectRatio, onSchedule }: { segment: Segment; captioned: boolean; setCaptioned: (value: boolean) => void; aspectRatio: Video["aspectRatio"]; onSchedule: () => void }) {
    const source = captioned && segment.captionedClipUrl ? segment.captionedClipUrl : segment.clipUrl;
    return <div className="flex w-full max-w-3xl flex-col items-center">
        <div className="mb-4 flex w-full items-center justify-between"><span className="text-sm text-zinc-400">{segment.title}</span>{segment.captionedClipUrl && <label className="flex items-center gap-2 text-xs text-zinc-500"><input type="checkbox" checked={captioned} onChange={(event) => setCaptioned(event.target.checked)} /> Captioned clip</label>}</div>
        <div className={`flex w-full items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-black ${aspectClasses[aspectRatio]}`}><video key={source ?? "empty"} controls className="h-full w-full object-contain" src={source ?? undefined} /></div>
        <div className="mt-4 flex w-full flex-wrap gap-2">
            <a href={source ?? "#"} download className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900">Download MP4</a>
            <button onClick={() => void navigator.clipboard.writeText(segment.thumbnailText ?? segment.title)} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900">Copy Hook / Title</button>
            <button onClick={onSchedule} className="ml-auto rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-400">Schedule to socials</button>
        </div>
    </div>;
}

function InsightsPanel({ segment, tab, setTab, onSaved }: { segment?: Segment; tab: "insights" | "quiz" | "schedule"; setTab: (tab: "insights" | "quiz" | "schedule") => void; onSaved: () => void }) {
    if (!segment) return <aside className="p-6 text-sm text-zinc-500">Select a segment.</aside>;
    const quiz = quizSchema.safeParse(segment.quiz);
    return <aside className="min-w-0 bg-[#18181b] p-5">
        <div className="mb-5 flex gap-1 rounded-lg bg-zinc-900 p-1">{[["insights", "AI insights"], ["quiz", "Quiz tester"], ["schedule", "Publish queue"]].map(([value, label]) => <button key={value} onClick={() => setTab(value as typeof tab)} className={`flex-1 rounded-md px-2 py-2 text-[11px] ${tab === value ? "bg-zinc-700 text-white" : "text-zinc-500"}`}>{label}</button>)}</div>
        {tab === "insights" && <MetadataEditor segment={segment} onSaved={onSaved} />}
        {tab === "quiz" && <QuizTester quiz={quiz.success ? quiz.data : []} />}
        {tab === "schedule" && <SchedulePanel segment={segment} />}
    </aside>;
}

function MetadataEditor({ segment, onSaved }: { segment: Segment; onSaved: () => void }) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(segment.title);
    const [thumbnailText, setThumbnailText] = useState(segment.thumbnailText ?? "");
    const [keyPoints, setKeyPoints] = useState(segment.keyPoints.join("\n"));
    const [saving, setSaving] = useState(false);
    async function save() {
        setSaving(true);
        try {
            const response = await fetch(`/api/segments/${segment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, thumbnailText: thumbnailText || null, keyPoints: keyPoints.split("\n").map((point) => point.trim()).filter(Boolean) }) });
            if (!response.ok) throw new Error("Unable to save metadata.");
            setEditing(false); onSaved();
        } catch (error) { console.error("Unable to save segment metadata.", error); } finally { setSaving(false); }
    }
    return <div className="space-y-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Key points & hook</h2><button onClick={() => setEditing(!editing)} className="text-xs text-blue-300">{editing ? "Cancel" : "Edit"}</button></div>
        {editing ? <><input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" /><input value={thumbnailText} onChange={(event) => setThumbnailText(event.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" /><textarea value={keyPoints} onChange={(event) => setKeyPoints(event.target.value)} rows={7} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" /><button onClick={() => void save()} disabled={saving} className="w-full rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium disabled:opacity-50">{saving ? "Saving..." : "Save changes"}</button></> : <><h3 className="text-lg font-medium">{segment.title}</h3>{segment.thumbnailText && <span className="inline-block rounded-md bg-fuchsia-500/15 px-3 py-1 text-xs font-bold tracking-wider text-fuchsia-300">{segment.thumbnailText}</span>}<ul className="space-y-3 text-sm leading-5 text-zinc-400">{segment.keyPoints.map((point) => <li key={point} className="flex gap-2"><span className="text-blue-400">•</span>{point}</li>)}</ul></>}</div>;
}

function QuizTester({ quiz }: { quiz: QuizQuestion[] }) {
    const [answers, setAnswers] = useState<Record<number, string>>({});
    if (!quiz.length) return <p className="text-sm text-zinc-500">Quiz data is unavailable or malformed.</p>;
    return <div className="space-y-5"><h2 className="text-sm font-semibold">Interactive quiz tester</h2>{quiz.map((item, index) => <div key={`${item.question}-${index}`} className="rounded-xl border border-zinc-800 p-3"><p className="text-sm text-zinc-200">{index + 1}. {item.question}</p><div className="mt-3 space-y-2">{item.options.map((option) => { const selected = answers[index] === option; const correct = option === item.answer; return <button key={option} onClick={() => setAnswers({ ...answers, [index]: option })} className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${selected && correct ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : selected ? "border-red-500 bg-red-500/10 text-red-300" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>{option}</button>; })}</div></div>)}</div>;
}

function SchedulePanel({ segment }: { segment: Segment }) {
    return <div className="space-y-5"><h2 className="text-sm font-semibold">Publish & schedule queue</h2>{segment.scheduledPosts.length ? <div className="space-y-2">{segment.scheduledPosts.map((post) => <div key={post.id} className="rounded-lg border border-zinc-800 p-3 text-xs"><div className="flex justify-between"><span>{post.socialAccount.platform}</span><span className="text-zinc-500">{post.status}</span></div><p className="mt-1 text-zinc-500">{new Date(post.scheduledFor).toLocaleString()}</p></div>)}</div> : <p className="text-xs text-zinc-500">No scheduled posts yet.</p>}<form onSubmit={(event) => event.preventDefault()} className="space-y-3"><select className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"><option>YOUTUBE_SHORTS</option><option>TIKTOK</option><option>INSTAGRAM_REELS</option><option>FACEBOOK_REELS</option></select><textarea placeholder="Caption and hashtags" rows={4} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" /><input type="datetime-local" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" /><button type="submit" className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300">Prepare schedule</button></form></div>;
}

function ScheduleModal({ segment, onClose }: { segment: Segment; onClose: () => void }) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-labelledby="schedule-title">
        <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-[#18181b] p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
                <div><h2 id="schedule-title" className="text-lg font-semibold">Schedule to socials</h2><p className="mt-1 text-xs text-zinc-500">{segment.title}</p></div>
                <button type="button" onClick={onClose} className="text-xl text-zinc-500 hover:text-white" aria-label="Close scheduling dialog">×</button>
            </div>
            <form onSubmit={(event) => event.preventDefault()} className="space-y-4">
                <label className="block text-xs text-zinc-400">Platform<select className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"><option>YOUTUBE_SHORTS</option><option>TIKTOK</option><option>INSTAGRAM_REELS</option><option>FACEBOOK_REELS</option></select></label>
                <label className="block text-xs text-zinc-400">Caption and hashtags<textarea rows={4} placeholder="Write a caption..." className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600" /></label>
                <label className="block text-xs text-zinc-400">Publish at<input type="datetime-local" className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200" /></label>
                <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300">Cancel</button><button type="submit" className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400">Prepare schedule</button></div>
            </form>
        </div>
    </div>;
}

function StudioSkeleton() {
    return <main className="min-h-screen animate-pulse bg-[#121214] p-8"><div className="mx-auto max-w-7xl"><div className="h-8 w-64 rounded bg-zinc-800" /><div className="mt-10 grid gap-6 lg:grid-cols-[280px_1fr_340px]"><div className="h-[70vh] rounded-2xl bg-zinc-900" /><div className="h-[70vh] rounded-2xl bg-zinc-900" /><div className="h-[70vh] rounded-2xl bg-zinc-900" /></div></div></main>;
}
