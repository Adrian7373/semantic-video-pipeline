# Project: Video Repurposer Architecture

## 1. Tech Stack
- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, Supabase SSR Auth.
- **Backend/Worker:** Node.js, BullMQ, Redis.
- **Microservice:** Python (Flask), faster-whisper, WhisperX.
- **Database:** PostgreSQL (via Supabase), Prisma ORM.

## 2. Architectural Boundaries (DO NOT BREAK)
- **Uploads:** The Next.js frontend MUST upload directly to AWS S3 using Presigned URLs. The Node backend should NEVER receive the raw video file.
- **Heavy Processing:** All FFmpeg commands (audio extraction, video slicing) MUST run in the Node.js Background Worker (via BullMQ), not in a Next.js web route.
- **Python's Role:** The Python Flask microservice ONLY handles audio-to-text transcription. It does NOT talk to the LLM or the database.
- **LLM Routing:** The Node.js worker handles sending the transcript to the LLM and receiving the JSON.
- **State Management:** Use Supabase Realtime (WebSockets) to push success signals to the frontend when the backend worker finishes a job.

## 3. Coding Standards
- Write strict TypeScript with proper interface definitions.
- Use Zod for validating the JSON schema returned by the LLM.
- Modularize code: keep FFmpeg logic, API routes, and queue logic in entirely separate files.