"use client";

import { ChangeEvent, FormEvent, useState, useEffect } from "react";
import { getPresignedUploadUrl } from "../../../actions/upload";
import type { AspectRatio, CaptionStyle } from "../../lib/queues";

type UploadStatus = "idle" | "requesting" | "uploading" | "processing" | "error";

const MOCK_USER_ID = "00000000-0000-4000-8000-000000000001";

const statusLabels: Record<UploadStatus, string> = {
    idle: "Ready to upload",
    requesting: "Preparing secure upload...",
    uploading: "Uploading video...", // Fallback, overridden by fun phrases
    processing: "Your video is now being processed. Check the videos library for future updates.",
    error: "Upload failed. Please try again.",
};

const funPhrases = [
    "Cooking...", "Let's hope it's worth the wait", "Feel free to spin in your chair",
    "Pretending to care...", "Waiting for motivation...", "Please wait while the minions do their work",
    "Please wait while the little elves draw your map", "Don't worry - a few bits tried to escape, but we caught them",
    "The server is powered by a lemon and two electrodes.", "We're testing your patience",
    "The bits are flowing slowly today", "Are we there yet?", "Just count to 10",
    "Counting backwards from Infinity", "We're making you a cookie.", "Spinning the wheel of fortune...",
    "Computing chance of success", "I feel like im supposed to be loading something. . .",
    "What do you call 8 Hobbits? A Hobbyte.", "Should have used a compiled language...",
    "Adjusting flux capacitor...", "Please wait until the sloth starts moving.", "Don't break your screen yet!",
    "I swear it's almost done.", "Let's take a mindfulness minute...", "Unicorns are at the end of this road, I promise.",
    "Connecting Neurotoxin Storage Tank...", "Time flies when you’re having fun.",
    "Get some coffee and come back in ten minutes..", "Spinning the hamster…", "Convincing AI not to turn evil..",
    "If I’m not back in five minutes, just wait longer.", "Laughing at your pictures-i mean, loading...",
    "Looking for sense of humour, please hold on.", "Please wait while the intern refills his coffee.",
    "Please hold on as we reheat our coffee", "Kindly hold on as we convert this bug to a feature...",
    "Distracted by cat gifs", "Loading funny message...", "Mining some bitcoins...", "Downloading more RAM..",
    "Updating to Windows Vista...", "Deleting System32 folder", "Never let a computer know you're in a hurry.",
    "Discovering new ways of making you wait...", "Your time is very important to us. Please wait while we ignore you...",
    "Sorry we are busy catching em' all, we're done soon", "Still faster than Windows update"
];

export default function VideoUploader() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<UploadStatus>("idle");
    const [progress, setProgress] = useState(0);
    const [userPrompt, setUserPrompt] = useState("");
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>("VERTICAL_9_16");
    const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("KARAOKE");
    const [loadingMessage, setLoadingMessage] = useState(funPhrases[0]);

    const isBusy = status === "requesting" || status === "uploading";

    // Cycle through fun phrases every 3.5 seconds while uploading
    useEffect(() => {
        if (status !== "uploading") return;
        const interval = setInterval(() => {
            setLoadingMessage(funPhrases[Math.floor(Math.random() * funPhrases.length)]);
        }, 3500);
        return () => clearInterval(interval);
    }, [status]);

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        setFile(event.target.files?.[0] ?? null);
        setStatus("idle");
        setProgress(0);
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;

        if (!file) {
            setStatus("error");
            return;
        }

        try {
            setStatus("requesting");
            setProgress(0);

            const initializationResponse = await fetch("/api/videos/init", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type,
                    fileSize: file.size,
                    userId: MOCK_USER_ID,
                    userPrompt,
                    aspectRatio,
                    captionStyle,
                }),
            });

            if (!initializationResponse.ok) {
                throw new Error("The video upload could not be initialized.");
            }

            const { videoId, s3Key } = (await initializationResponse.json()) as {
                videoId: string;
                s3Key: string;
            };
            const { uploadUrl } = await getPresignedUploadUrl({
                filename: file.name,
                contentType: file.type,
                fileSize: file.size,
            }, s3Key);

            // Pick a random starting phrase before switching status
            setLoadingMessage(funPhrases[Math.floor(Math.random() * funPhrases.length)]);
            setStatus("uploading");

            await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percentComplete = Math.round((event.loaded / event.total) * 95);
                        setProgress(percentComplete);
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new Error("The video could not be uploaded to storage."));
                    }
                };

                xhr.onerror = () => reject(new Error("Network error during upload."));

                xhr.open("PUT", uploadUrl);
                xhr.setRequestHeader("Content-Type", file.type);
                xhr.send(file);
            });

            setStatus("processing");
            setProgress(98);

            const processResponse = await fetch("/api/videos/process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    s3Key,
                    videoId,
                    userId: MOCK_USER_ID,
                    userPrompt,
                    aspectRatio,
                    captionStyle,
                }),
            });

            if (!processResponse.ok) {
                throw new Error("The video could not be queued for processing.");
            }

            setProgress(100);
            setFile(null);
            form.reset();
        } catch (error) {
            console.error("Video upload failed.", error);
            setStatus("error");
            setProgress(0);
        }
    };

    return (
        <section className="w-full max-w-xl rounded-2xl border border-neutral-800 bg-[#1C1C1E] p-6 shadow-2xl shadow-black/20">
            <div className="mb-6">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">
                    Video repurposer
                </p>
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">
                    Upload a lecture
                </h1>
                <p className="mt-2 text-sm leading-6 text-neutral-400">
                    Your video is uploaded directly to secure storage before processing.
                </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
                <label className="block">
                    <span className="mb-2 block text-sm font-medium text-neutral-300">
                        Video file
                    </span>
                    <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={handleFileChange}
                        disabled={isBusy}
                        className="block w-full cursor-pointer rounded-lg border border-neutral-700 bg-[#171717] text-sm text-neutral-400 file:mr-4 file:border-0 file:border-r file:border-neutral-700 file:bg-neutral-800 file:px-4 file:py-3 file:text-sm file:font-medium file:text-neutral-200 hover:file:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                </label>

                <label className="block">
                    <span className="mb-2 block text-sm font-medium text-neutral-300">
                        AI clipping prompt
                    </span>
                    <textarea
                        value={userPrompt}
                        onChange={(event) => setUserPrompt(event.target.value)}
                        maxLength={1000}
                        rows={3}
                        placeholder="Find the funniest moments or key technical takeaways"
                        disabled={isBusy}
                        className="block w-full resize-y rounded-lg border border-neutral-700 bg-[#171717] px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium text-neutral-300">
                            Aspect ratio
                        </span>
                        <select
                            value={aspectRatio}
                            onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}
                            disabled={isBusy}
                            className="block w-full rounded-lg border border-neutral-700 bg-[#171717] px-3 py-2 text-sm text-neutral-200 disabled:opacity-50"
                        >
                            <option value="VERTICAL_9_16">9:16 Vertical</option>
                            <option value="LANDSCAPE_16_9">16:9 Landscape</option>
                            <option value="SQUARE_1_1">1:1 Square</option>
                        </select>
                    </label>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium text-neutral-300">
                            Caption style
                        </span>
                        <select
                            value={captionStyle}
                            onChange={(event) => setCaptionStyle(event.target.value as CaptionStyle)}
                            disabled={isBusy}
                            className="block w-full rounded-lg border border-neutral-700 bg-[#171717] px-3 py-2 text-sm text-neutral-200 disabled:opacity-50"
                        >
                            <option value="KARAOKE">Karaoke</option>
                            <option value="HIGHLIGHT">Highlight</option>
                            <option value="MINIMAL">Minimal</option>
                            <option value="NONE">None</option>
                        </select>
                    </label>
                </div>

                {file && (
                    <p className="truncate rounded-lg bg-neutral-900 px-3 py-2 text-sm text-neutral-400">
                        Selected: {file.name}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={isBusy || !file}
                    className="w-full rounded-lg bg-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-500"
                >
                    {isBusy ? "Working..." : "Upload and process"}
                </button>

                <div className="space-y-2">
                    <div className={`flex items-center justify-between text-sm ${status === "error" ? "text-red-400" : "text-neutral-500"}`}>
                        <span aria-live="polite" className="truncate pr-4">
                            {status === "uploading" ? loadingMessage : statusLabels[status]}
                        </span>
                        {status === "uploading" && (
                            <span className="font-medium whitespace-nowrap text-neutral-400">{progress}%</span>
                        )}
                    </div>

                    {status !== "idle" && status !== "error" && (
                        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                            <style>{`
                                @keyframes progress-shine {
                                    0% { transform: translateX(-100%); }
                                    100% { transform: translateX(100%); }
                                }
                                .animate-progress-shine {
                                    animation: progress-shine 1.5s infinite linear;
                                }
                            `}</style>
                            <div
                                className="relative h-full bg-neutral-200 transition-all duration-300 ease-out overflow-hidden"
                                style={{ width: `${progress}%` }}
                            >
                                <div className="absolute inset-0 w-full animate-progress-shine bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                            </div>
                        </div>
                    )}
                </div>
            </form>
        </section>
    );
}