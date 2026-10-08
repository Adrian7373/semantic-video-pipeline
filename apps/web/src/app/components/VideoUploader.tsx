"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { getPresignedUploadUrl } from "../../../actions/upload";

type UploadStatus = "idle" | "requesting" | "uploading" | "processing" | "error";

const MOCK_USER_ID = "mock-user-id";

const statusLabels: Record<UploadStatus, string> = {
    idle: "Ready to upload",
    requesting: "Preparing secure upload...",
    uploading: "Uploading video directly to storage...",
    processing: "Queued for processing...",
    error: "Upload failed. Please try again.",
};

export default function VideoUploader() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<UploadStatus>("idle");

    const isBusy = status === "requesting" || status === "uploading" || status === "processing";

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        setFile(event.target.files?.[0] ?? null);
        setStatus("idle");
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!file) {
            setStatus("error");
            return;
        }

        try {
            setStatus("requesting");
            const { uploadUrl, s3Key } = await getPresignedUploadUrl({
                filename: file.name,
                contentType: file.type,
                fileSize: file.size,
            });


            setStatus("uploading");
            const uploadResponse = await fetch(uploadUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": file.type,
                },
                body: file,
            });

            if (!uploadResponse.ok) {
                throw new Error("The video could not be uploaded to storage.");
            }

            setStatus("processing");
            const processResponse = await fetch("/api/videos/process", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    s3Key,
                    videoId: crypto.randomUUID(),
                    userId: MOCK_USER_ID,
                }),
            });

            if (!processResponse.ok) {
                throw new Error("The video could not be queued for processing.");
            }

            setFile(null);
            event.currentTarget.reset();
        } catch (error) {
            console.error("Video upload failed.", error);
            setStatus("error");
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

                <p
                    aria-live="polite"
                    className={`text-sm ${status === "error" ? "text-red-400" : "text-neutral-500"
                        }`}
                >
                    {statusLabels[status]}
                </p>
            </form>
        </section>
    );
}
