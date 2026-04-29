from fastapi import FastAPI
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager

from ingest.rss_parser import poll_rss_feeds
from ingest.twitter_stream import start_twitter_stream
from ingest.radio_transcriber import monitor_radio
import config

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # RSS: poll every 60 seconds
    scheduler.add_job(poll_rss_feeds, "interval", seconds=60, id="rss")

    # Radio: continuous 30-second windows
    scheduler.add_job(monitor_radio, "interval", seconds=30, id="radio")

    scheduler.start()

    # Twitter stream runs as a background task if token is present
    if config.TWITTER_BEARER_TOKEN:
        import asyncio
        asyncio.create_task(start_twitter_stream())

    yield

    scheduler.shutdown()

app = FastAPI(title="SentinelMesh Signal Service", lifespan=lifespan)

@app.get("/health")
def health():
    return {"ok": True, "service": "signal"}
