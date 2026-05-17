import feedparser
import asyncio
import concurrent.futures
import sentry_sdk
import redis.asyncio as aioredis
from datetime import datetime, timezone

import config
from publisher import emit_event, get_client
from ingest.deduplicator import is_duplicate
from nlp.classifier import classify_event
from nlp.location_extractor import extract_locations
from nlp.severity_scorer import score_severity
from nlp.event_fuser import build_event


async def _process_entry(entry: dict, source_url: str, client: aioredis.Redis) -> None:
    title = entry.get("title", "")
    summary = entry.get("summary", "") or entry.get("description", "")
    text = f"{title}. {summary}"

    if await is_duplicate(text, client):
        return

    classification = await asyncio.to_thread(classify_event, text)
    if classification["event_type"] == "FALSE_ALARM" or classification["confidence"] < 0.3:
        return

    locations = extract_locations(text)
    location = locations[0] if locations else None

    # Skip events with no Kenya location — we are Kenya-scoped only
    if location is None:
        return

    severity = score_severity(text)
    published = entry.get("published_parsed")
    ts = (
        datetime(*published[:6], tzinfo=timezone.utc)
        if published
        else datetime.now(timezone.utc)
    )

    signal = {
        "event_type": classification["event_type"],
        "severity": severity,
        "title": title[:200],
        "summary": summary[:500] if summary else None,
        "location": location,
        "confidence": classification["confidence"],
        "source_type": "rss",
        "timestamp": ts,
    }

    event = build_event([signal])
    await emit_event(event)


async def poll_rss_feeds() -> None:
    """Fetch all RSS feeds and process new entries. Runs every 60 seconds."""
    client = await get_client()

    for feed_url in config.RSS_FEEDS:
        try:
            # feedparser is synchronous — run in thread pool with a hard timeout
            # to prevent a slow or hung feed from stalling the entire polling cycle
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                future = ex.submit(feedparser.parse, feed_url)
                try:
                    feed = future.result(timeout=10)
                except concurrent.futures.TimeoutError:
                    print(f"feedparser timed out for {feed_url}")
                    continue

            for entry in feed.entries:
                try:
                    await _process_entry(entry, feed_url, client)
                except Exception as e:
                    # Log and continue — one bad entry should not stop the feed
                    sentry_sdk.capture_exception(e)
                    print(f"RSS entry processing error ({feed_url}): {e}")

        except Exception as e:
            print(f"RSS feed fetch failed ({feed_url}): {e}")
