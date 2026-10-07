import os
import tempfile
from functools import lru_cache
from typing import Any, TypedDict

import whisperx
from faster_whisper import WhisperModel
from flask import Flask, jsonify, request
from werkzeug.datastructures import FileStorage

app = Flask(__name__)

DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "small")


class TranscriptSegment(TypedDict):
    start: float
    end: float
    text: str


class TranscriptionResponse(TypedDict):
    segments: list[TranscriptSegment]
    language: str


@lru_cache(maxsize=1)
def get_whisper_model() -> WhisperModel:
    return WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)


def transcribe_audio(audio_path: str) -> TranscriptionResponse:
    """Transcribe audio with faster-whisper and align timestamps with WhisperX."""
    model = get_whisper_model()
    segments, info = model.transcribe(audio_path)
    transcript_segments = [
        {"start": segment.start, "end": segment.end, "text": segment.text}
        for segment in segments
    ]

    align_model, align_metadata = whisperx.load_align_model(
        language_code=info.language,
        device=DEVICE,
    )
    aligned = whisperx.align(
        transcript_segments,
        align_model,
        align_metadata,
        audio_path,
        DEVICE,
        return_char_alignments=False,
    )

    return {
        "segments": [
            {
                "start": float(segment["start"]),
                "end": float(segment["end"]),
                "text": str(segment["text"]),
            }
            for segment in aligned["segments"]
        ],
        "language": info.language,
    }


@app.post("/transcribe")
def transcribe() -> tuple[Any, int]:
    uploaded_file: FileStorage | None = request.files.get("file")
    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"error": "An audio file is required in the 'file' field."}), 400

    file_suffix = os.path.splitext(uploaded_file.filename)[1]
    temporary_file = tempfile.NamedTemporaryFile(
        prefix="video-repurposer-",
        suffix=file_suffix,
        delete=False,
    )
    temporary_path = temporary_file.name
    temporary_file.close()

    try:
        uploaded_file.save(temporary_path)
        return jsonify(transcribe_audio(temporary_path)), 200
    finally:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
