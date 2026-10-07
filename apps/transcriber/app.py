import os
import tempfile
from typing import Any

from flask import Flask, jsonify, request
from werkzeug.datastructures import FileStorage

app = Flask(__name__)


def transcribe_audio(audio_path: str) -> list[dict[str, Any]]:
    """Placeholder for the faster-whisper transcription call."""
    return [
        {
            "start": 0.0,
            "end": 12.5,
            "text": "Sample lecture transcript...",
        }
    ]


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
