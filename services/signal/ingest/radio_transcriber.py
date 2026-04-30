"""Radio stream monitoring: queue transcription jobs for ML worker."""

import logging
import time
from datetime import datetime, timezone

import config
from .stream_validator import validate_stream
from queue_manager import QueueManager

logger = logging.getLogger(__name__)

# Queue manager instance (initialized once per process)
_queue: QueueManager | None = None

# Track consecutive validation failures per stream.
# A stream with >= 3 failures is skipped for the current cycle.
_failure_counts: dict[str, int] = {}

# Track the last time.monotonic() a warning was logged per stream.
# Warnings are suppressed if fewer than 60 seconds have passed.
_last_warned: dict[str, float] = {}

# Track when a stream first entered cooldown so it can be retried after the window.
_cooldown_since: dict[str, float] = {}

_BACKOFF_THRESHOLD = 3
_LOG_WINDOW_SECONDS = 60
_COOLDOWN_RESET_SECONDS = 300


async def get_queue() -> QueueManager:
    """Get or initialize the queue manager."""
    global _queue
    if _queue is None:
        _queue = QueueManager(config.REDIS_URL)
        await _queue.init()
    return _queue


async def monitor_radio() -> None:
    """
    Monitor all configured radio streams and queue transcription jobs.

    Runs every 30 seconds via APScheduler.
    Instead of transcribing directly (heavy), queue jobs for the ML worker.

    Streams with 3 or more consecutive failures are cooled down (skipped for
    the current cycle). Failure warnings are throttled to once per 60 seconds
    per stream to prevent log spam.
    """
    queue = await get_queue()

    queued_count = 0
    total_count = 0

    for station_name, stream_url in config.RADIO_STREAMS.items():
        # Skip cooling-down streams, but reset after the cooldown window
        if _failure_counts.get(station_name, 0) >= _BACKOFF_THRESHOLD:
            elapsed = time.monotonic() - _cooldown_since.get(station_name, 0)
            if elapsed < _COOLDOWN_RESET_SECONDS:
                logger.debug(
                    "Radio monitor: %s is cooling down (%d failures, %.0fs remaining), skipping",
                    station_name,
                    _failure_counts[station_name],
                    _COOLDOWN_RESET_SECONDS - elapsed,
                )
                continue
            # Cooldown expired — give the stream another chance
            logger.info("Radio monitor: %s cooldown expired, retrying", station_name)
            _failure_counts[station_name] = 0

        total_count += 1

        try:
            is_live = await validate_stream(stream_url)

            if not is_live:
                _failure_counts[station_name] = _failure_counts.get(station_name, 0) + 1
                if _failure_counts[station_name] == _BACKOFF_THRESHOLD:
                    _cooldown_since[station_name] = time.monotonic()
                now = time.monotonic()
                if now - _last_warned.get(station_name, 0) >= _LOG_WINDOW_SECONDS:
                    logger.warning(
                        "Radio %s: stream unavailable (failures=%d)",
                        station_name,
                        _failure_counts[station_name],
                    )
                    _last_warned[station_name] = now
                continue

            # Stream is live — reset failure tracking
            _failure_counts[station_name] = 0

            job_id = await queue.enqueue(
                "transcribe_audio",
                {
                    "stream_id": station_name,
                    "audio_url": stream_url,
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                },
            )

            logger.info("Queued transcription job %s for %s", job_id, station_name)
            queued_count += 1

        except Exception:
            logger.exception("Radio %s: error during job queueing", station_name)

    logger.info(
        "Radio monitor: queued %d/%d streams",
        queued_count,
        total_count,
    )
