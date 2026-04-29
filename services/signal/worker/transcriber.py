"""ML Worker: Whisper transcription and NLP pipeline."""

import asyncio
import logging
import os
from datetime import datetime, timezone

import config
from queue_manager import QueueManager
from publisher import emit_event, get_client
import worker.audio_capture as _audio_capture

logger = logging.getLogger(__name__)

MIN_TRANSCRIPT_CHARS = 30
TRANSCRIPTION_TIMEOUT = 120  # hard ceiling per job in seconds

# Initialised inside worker_loop(), not at module import time.
# This prevents the 1-2 GB model load from happening during test collection
# or if this module is imported for other reasons.
MODEL = None


def _load_model():
    from faster_whisper import WhisperModel
    return WhisperModel(config.WHISPER_MODEL, device="cpu", compute_type="int8")


def _transcribe(model, audio_path: str) -> str:
    """Run faster-whisper synchronously; called via run_in_executor."""
    segments, _ = model.transcribe(
        audio_path,
        language=None,           # auto-detect Swahili or English
        initial_prompt="Kenya news broadcast:",
        vad_filter=True,         # skip silent gaps, reduces false short transcripts
    )
    return " ".join(seg.text for seg in segments).strip()


async def process_transcription_job(job_data: dict) -> dict:
    job_id = job_data["id"]
    payload = job_data["payload"]
    audio_path = None

    try:
        logger.info(f"Processing job {job_id} from {payload.get('stream_id')}")

        # Capture a 30-second, frame-safe WAV segment via ffmpeg
        audio_path = await _audio_capture.capture_audio_segment(payload["audio_url"], duration=30)

        # Transcribe with a hard timeout — stuck jobs must not block the loop forever
        loop = asyncio.get_event_loop()
        text = await asyncio.wait_for(
            loop.run_in_executor(None, _transcribe, MODEL, audio_path),
            timeout=TRANSCRIPTION_TIMEOUT,
        )

        if len(text) < MIN_TRANSCRIPT_CHARS:
            logger.info(f"Job {job_id}: transcript too short ({len(text)} chars)")
            return {"status": "skipped", "reason": "transcript_too_short"}

        # Lazy imports — spacy and other ML deps are not installed in the dev/test
        # environment and should not fail at module import time.
        from ingest.deduplicator import is_duplicate
        from nlp.classifier import classify_event
        from nlp.location_extractor import extract_locations
        from nlp.severity_scorer import score_severity
        from nlp.event_fuser import build_event

        redis_client = await get_client()
        if await is_duplicate(text, redis_client):
            logger.info(f"Job {job_id}: duplicate")
            return {"status": "skipped", "reason": "duplicate"}

        classification = classify_event(text)
        if classification["confidence"] < 0.4:
            logger.info(f"Job {job_id}: low confidence {classification['confidence']}")
            return {"status": "skipped", "reason": "low_confidence"}

        locations = extract_locations(text)
        if not locations:
            logger.info(f"Job {job_id}: no locations found")
            return {"status": "skipped", "reason": "no_locations"}

        signal = {
            "event_type": classification["event_type"],
            "severity": score_severity(text),
            "title": text[:200],
            "summary": text[:500],
            "location": locations[0],
            "confidence": classification["confidence"],
            "source_type": "radio",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        event = build_event([signal])
        await emit_event(event)

        logger.info(f"Job {job_id}: completed, event emitted")
        return {
            "status": "completed",
            "transcript": text,
            "event_type": classification["event_type"],
            "locations": locations,
        }

    except asyncio.TimeoutError:
        logger.error(f"Job {job_id}: transcription exceeded {TRANSCRIPTION_TIMEOUT}s")
        return {"status": "failed", "error": f"transcription timeout after {TRANSCRIPTION_TIMEOUT}s"}

    except Exception as e:
        logger.exception(f"Job {job_id}: unhandled error")
        return {"status": "failed", "error": str(e)}

    finally:
        if audio_path:
            _audio_capture._safe_unlink(audio_path)


async def worker_loop():
    global MODEL

    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    logger.info(f"Loading Whisper model '{config.WHISPER_MODEL}' ...")
    MODEL = _load_model()
    logger.info("Whisper model ready.")

    queue = QueueManager(config.REDIS_URL)
    await queue.init()
    logger.info("ML Worker started.")

    try:
        while True:
            job_data = await queue.dequeue("transcribe_audio", timeout=5)
            if not job_data:
                continue

            job_id = job_data["id"]
            await queue.update_job(job_id, {
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
            })

            result = await process_transcription_job(job_data)

            if result["status"] == "failed":
                # Retry or send to dead-letter — do not silently discard failures
                await queue.requeue_failed(job_data, result)
            else:
                await queue.update_job(job_id, {
                    "status": result.get("status"),
                    "result": result,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                })

            await queue.publish_result("worker:transcription_complete", {
                "job_id": job_id,
                "status": result.get("status"),
                "transcript": result.get("transcript"),
                "stream_id": job_data["payload"].get("stream_id"),
            })

    except KeyboardInterrupt:
        logger.info("Worker shutting down...")
    finally:
        await queue.close()


if __name__ == "__main__":
    asyncio.run(worker_loop())
