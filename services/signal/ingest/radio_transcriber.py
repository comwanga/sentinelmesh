import whisper
import httpx
import asyncio
from io import BytesIO
from datetime import datetime, timezone

import config
from publisher import emit_event, get_client
from ingest.deduplicator import is_duplicate
from nlp.classifier import classify_event
from nlp.location_extractor import extract_locations
from nlp.severity_scorer import score_severity
from nlp.event_fuser import build_event

# Load model once at module level — heavy, never reload per request.
# Uses WHISPER_MODEL env var: "base" in dev, "large-v3" in production.
_model = whisper.load_model(config.WHISPER_MODEL)

# Minimum meaningful transcript length — filters out silence and noise
MIN_TRANSCRIPT_CHARS = 30


async def _capture_audio(stream_url: str, duration_seconds: int = 30) -> BytesIO:
    """Download a fixed number of bytes from an HLS/MP3 stream (approx 30s at 128kbps)."""
    target_bytes = (128_000 * duration_seconds) // 8
    buffer = BytesIO()

    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream("GET", stream_url) as response:
            async for chunk in response.aiter_bytes(chunk_size=4096):
                buffer.write(chunk)
                if buffer.tell() >= target_bytes:
                    break

    buffer.seek(0)
    return buffer


async def _transcribe_and_process(station_name: str, stream_url: str) -> None:
    redis_client = await get_client()

    try:
        audio = await _capture_audio(stream_url)
    except Exception as e:
        print(f"Radio capture failed ({station_name}): {e}")
        return

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: _model.transcribe(
                audio,
                language=None,          # auto-detect sw or en
                task="transcribe",
                initial_prompt="Kenya news broadcast:",
                fp16=False,
            ),
        )
        text = result.get("text", "").strip()
    except Exception as e:
        print(f"Whisper transcription failed ({station_name}): {e}")
        return

    if len(text) < MIN_TRANSCRIPT_CHARS:
        return

    if await is_duplicate(text, redis_client):
        return

    classification = classify_event(text)
    if classification["confidence"] < 0.4:
        return

    locations = extract_locations(text)
    if not locations:
        return

    signal = {
        "event_type": classification["event_type"],
        "severity": score_severity(text),
        "title": text[:200],
        "summary": text[:500],
        "location": locations[0],
        "confidence": classification["confidence"],
        "source_type": "radio",
        "timestamp": datetime.now(timezone.utc),
    }
    event = build_event([signal])
    await emit_event(event)


async def monitor_radio() -> None:
    """Transcribe all configured radio streams concurrently. Runs every 30 seconds."""
    tasks = [
        _transcribe_and_process(name, url)
        for name, url in config.RADIO_STREAMS.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for name, result in zip(config.RADIO_STREAMS.keys(), results):
        if isinstance(result, Exception):
            print(f"Radio monitor error ({name}): {result}")
