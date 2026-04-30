import logging
import os
import asyncio
import sentry_sdk
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sentry_sdk.integrations.fastapi import FastAPIIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from ingest.rss_parser import poll_rss_feeds
from ingest.twitter_stream import start_twitter_stream
from ingest.radio_transcriber import monitor_radio
from queue_manager import QueueManager
import config

# --- SENTRY INITIALIZATION ---
# We initialize this at the top level so it wraps the entire process
if os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        # Starlette + FastAPI integrations for better request tracking
        integrations=[
            StarletteIntegration(),
            FastAPIIntegration(),
        ],
        # Capture 100% of transactions for performance monitoring
        traces_sample_rate=1.0,
        # Privacy: Do not send user PII like IPs or account details
        send_default_pii=False,
        environment=os.environ.get("NODE_ENV", "development"),
    )

scheduler = AsyncIOScheduler()
_queue_manager: QueueManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _queue_manager

    if not os.environ.get("DATABASE_URL"):
        # Sentry will catch this RuntimeError automatically
        raise RuntimeError("DATABASE_URL is required for the signal API service")

    if _queue_manager is None:
        try:
            redis_url = config.REDIS_URL
            qm = QueueManager(redis_url)
            await qm.init()
            _queue_manager = qm
        except Exception as exc:
            # Explicitly capture this exception in Sentry
            sentry_sdk.capture_exception(exc)
            logging.error("QueueManager init failed: %s", exc)

    # Schedule Jobs
    scheduler.add_job(poll_rss_feeds, "interval", seconds=60, id="rss")
    scheduler.add_job(monitor_radio, "interval", seconds=30, id="radio")
    scheduler.start()

    if config.TWITTER_BEARER_TOKEN:
        asyncio.create_task(start_twitter_stream())

    yield

    # Shutdown logic
    scheduler.shutdown()
    if _queue_manager is not None:
        await _queue_manager.close()


app = FastAPI(title="SentinelMesh Signal Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "service": "signal"}


@app.get("/health/detailed")
async def health_detailed():
    if _queue_manager is None:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "reason": "queue not initialized"},
        )

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