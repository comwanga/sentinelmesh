"""ML Worker: Handles Whisper transcription and NLP processing."""

import asyncio
import json
import logging
from datetime import datetime, timezone

import whisper

import config
from queue_manager import QueueManager
from publisher import emit_event
from ingest.deduplicator import is_duplicate
from nlp.classifier import classify_event
from nlp.location_extractor import extract_locations
from nlp.severity_scorer import score_severity
from nlp.event_fuser import build_event

logger = logging.getLogger(__name__)

# Load Whisper model ONCE at startup (global, shared by all jobs)
# Uses WHISPER_MODEL env var: "base" in dev, "large-v3" in production.
MODEL = whisper.load_model(config.WHISPER_MODEL)

# Minimum meaningful transcript length
MIN_TRANSCRIPT_CHARS = 30


async def process_transcription_job(job_data: dict) -> dict:
    """
    Process a transcription job: fetch audio, transcribe, run NLP pipeline.

    Args:
        job_data: Job with payload containing audio_url, stream_id, etc.

    Returns:
        Result dict with transcript, event data, or error
    """
    job_id = job_data["id"]
    payload = job_data["payload"]

    try:
        logger.info(f"Processing transcription job {job_id} from {payload.get('stream_id')}")

        # Download and transcribe (blocking CPU operation, OK in worker context)
        import httpx
        from io import BytesIO

        # Capture ~30 seconds of audio from stream
        target_bytes = (128_000 * 30) // 8  # 128kbps * 30s
        buffer = BytesIO()

        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("GET", payload["audio_url"]) as response:
                async for chunk in response.aiter_bytes(chunk_size=4096):
                    buffer.write(chunk)
                    if buffer.tell() >= target_bytes:
                        break

        buffer.seek(0)

        # Transcribe with Whisper (runs in event loop via executor)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: MODEL.transcribe(
                buffer,
                language=None,  # auto-detect Swahili or English
                task="transcribe",
                initial_prompt="Kenya news broadcast:",
                fp16=False,  # No half-precision needed for CPU
            ),
        )

        text = result.get("text", "").strip()

        if len(text) < MIN_TRANSCRIPT_CHARS:
            logger.info(f"Job {job_id}: transcript too short ({len(text)} chars)")
            return {"status": "skipped", "reason": "transcript_too_short"}

        # Check for duplicates
        from publisher import get_client

        redis_client = await get_client()
        if await is_duplicate(text, redis_client):
            logger.info(f"Job {job_id}: duplicate detected")
            return {"status": "skipped", "reason": "duplicate"}

        # Run NLP pipeline
        classification = classify_event(text)
        if classification["confidence"] < 0.4:
            logger.info(f"Job {job_id}: low confidence ({classification['confidence']})")
            return {"status": "skipped", "reason": "low_confidence"}

        locations = extract_locations(text)
        if not locations:
            logger.info(f"Job {job_id}: no locations found")
            return {"status": "skipped", "reason": "no_locations"}

        # Build event from signals
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

        # Emit to gateway
        await emit_event(event)

        logger.info(f"Job {job_id}: completed, event emitted")
        return {
            "status": "completed",
            "transcript": text,
            "event_type": classification["event_type"],
            "locations": locations,
        }

    except Exception as e:
        logger.exception(f"Job {job_id}: error during processing")
        return {"status": "failed", "error": str(e)}


async def worker_loop():
    """
    Main worker loop: listen on Redis queue, process jobs.

    Blocks on queue.transcribe_audio, processes jobs indefinitely.
    """
    queue = QueueManager(config.REDIS_URL)
    await queue.init()

    logger.info(f"ML Worker started. Whisper model: {config.WHISPER_MODEL}")

    try:
        while True:
            # Block on queue with 5s timeout (allows graceful shutdown)
            job_data = await queue.dequeue("transcribe_audio", timeout=5)

            if not job_data:
                continue

            job_id = job_data["id"]

            # Update status to running
            await queue.update_job(job_id, {"status": "running", "started_at": datetime.utcnow().isoformat()})

            # Process the job
            result = await process_transcription_job(job_data)

            # Update job with result
            await queue.update_job(
                job_id,
                {
                    "status": result.get("status"),
                    "result": result,
                    "completed_at": datetime.utcnow().isoformat(),
                },
            )

            # Publish to Redis pub/sub for listeners (optional, for real-time dashboards)
            await queue.publish_result(
                "worker:transcription_complete",
                {
                    "job_id": job_id,
                    "status": result.get("status"),
                    "transcript": result.get("transcript"),
                    "stream_id": job_data["payload"].get("stream_id"),
                },
            )

    except KeyboardInterrupt:
        logger.info("Worker shutting down...")
    finally:
        await queue.close()


if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL.upper(), "INFO"),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    try:
        asyncio.run(worker_loop())
    except KeyboardInterrupt:
        print("Worker interrupted")
        sys.exit(0)
