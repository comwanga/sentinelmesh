"""Radio stream monitoring: queue transcription jobs for ML worker."""

import logging
from datetime import datetime, timezone

import httpx

import config
from queue_manager import QueueManager

logger = logging.getLogger(__name__)

# Queue manager instance (initialized once per process)
_queue: QueueManager | None = None


async def get_queue() -> QueueManager:
    """Get or initialize the queue manager."""
    global _queue
    if _queue is None:
        _queue = QueueManager(config.REDIS_URL)
        await _queue.init()
    return _queue


async def _capture_audio_metadata(stream_url: str, duration_seconds: int = 30) -> dict:
    """Check that stream is alive and capture audio segment."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.head(stream_url)
            response.raise_for_status()
        return {
            "status": "ok",
            "stream_url": stream_url,
            "duration": duration_seconds,
        }
    except Exception as e:
        logger.warning(f"Stream check failed: {e}")
        return {"status": "error", "error": str(e)}


async def monitor_radio() -> None:
    """
    Monitor all configured radio streams and queue transcription jobs.

    Runs every 30 seconds via APScheduler.
    Instead of transcribing directly (heavy), queue jobs for the ML worker.
    """
    queue = await get_queue()

    logger.info("Radio monitor: checking streams and queueing transcription jobs")

    tasks = []
    for station_name, stream_url in config.RADIO_STREAMS.items():
        try:
            # Quick sanity check on stream
            metadata = await _capture_audio_metadata(stream_url)
            if metadata["status"] != "ok":
                logger.warning(f"Radio {station_name}: stream unavailable - {metadata.get('error')}")
                continue

            # Queue transcription job for ML worker
            job_id = await queue.enqueue(
                "transcribe_audio",
                {
                    "stream_id": station_name,
                    "audio_url": stream_url,
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                },
            )

            logger.info(f"Queued transcription job {job_id} for {station_name}")

        except Exception as e:
            logger.exception(f"Radio {station_name}: error during job queueing")

    logger.info(f"Radio monitor: queued jobs for {len(config.RADIO_STREAMS)} streams")

