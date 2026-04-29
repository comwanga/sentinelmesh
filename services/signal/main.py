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
    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required for the signal API service")

    scheduler.add_job(poll_rss_feeds, "interval", seconds=60, id="rss")
    scheduler.add_job(monitor_radio, "interval", seconds=30, id="radio")
    scheduler.start()

    if config.TWITTER_BEARER_TOKEN:
        import asyncio
        asyncio.create_task(start_twitter_stream())

    yield

    scheduler.shutdown()

app = FastAPI(title="SentinelMesh Signal Service", lifespan=lifespan)

@app.get("/health")
def health():
    return {"ok": True, "service": "signal"}
