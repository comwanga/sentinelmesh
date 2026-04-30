from contextlib import asynccontextmanager
from fastapi import FastAPI
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from ingest.rss_parser import poll_rss_feeds
from ingest.twitter_stream import start_twitter_stream
from ingest.radio_transcriber import monitor_radio
from queue_manager import QueueManager
import config

scheduler = AsyncIOScheduler()
_queue_manager: QueueManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _queue_manager

    import os
    if not os.environ.get("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is required for the signal API service")

    # Guard: allow tests (and future code) to inject a QueueManager before
    # startup. Only initialise if one has not already been provided.
    if _queue_manager is None:
        try:
            redis_url = os.environ.get("REDIS_URL") or config.REDIS_URL
            qm = QueueManager(redis_url)
            await qm.init()
            _queue_manager = qm
        except Exception as exc:
            # Log and continue — health endpoint will report not-initialized.
            print(f"QueueManager init failed: {exc}")

    scheduler.add_job(poll_rss_feeds, "interval", seconds=60, id="rss")
    scheduler.add_job(monitor_radio, "interval", seconds=30, id="radio")
    scheduler.start()

    if config.TWITTER_BEARER_TOKEN:
        import asyncio
        asyncio.create_task(start_twitter_stream())

    yield

    scheduler.shutdown()
    if _queue_manager is not None:
        result = _queue_manager.close()
        if hasattr(result, "__await__"):
            await result


app = FastAPI(title="SentinelMesh Signal Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "service": "signal"}


@app.get("/health/detailed")
async def health_detailed():
    """Queue depths for alerting. Alert when transcribe_audio or dead_letter > threshold."""
    if _queue_manager is None:
        return {"ok": False, "reason": "queue not initialized"}

    transcribe_depth = await _queue_manager.get_queue_length("transcribe_audio")
    dlq_depth = await _queue_manager.get_queue_length("dead_letter")

    return {
        "ok": True,
        "service": "signal",
        "queue_depth": {
            "transcribe_audio": transcribe_depth,
            "dead_letter": dlq_depth,
        },
    }
