import httpx
import json
import asyncio
import sentry_sdk
from datetime import datetime, timezone

import config
from publisher import emit_event, get_client
from ingest.deduplicator import is_duplicate
from nlp.classifier import classify_event
from nlp.location_extractor import extract_locations
from nlp.severity_scorer import score_severity
from nlp.event_fuser import build_event

# Keywords that narrow the stream to safety-relevant Kenyan content
STREAM_RULES = [
    {"value": "matatu OR ajali OR mafuriko OR maandamano lang:sw", "tag": "swahili-safety"},
    {"value": "(flood OR accident OR protest OR fire OR robbery) (nairobi OR mombasa OR kenya) lang:en", "tag": "english-safety"},
]

HEADERS = {
    "Authorization": f"Bearer {config.TWITTER_BEARER_TOKEN}",
    "Content-Type": "application/json",
}


async def _set_rules(client: httpx.AsyncClient) -> None:
    """Replace existing stream rules with our safety keyword rules."""
    # Delete all current rules first
    existing = await client.get("https://api.twitter.com/2/tweets/search/stream/rules", headers=HEADERS)
    if existing.status_code == 200:
        rule_ids = [r["id"] for r in existing.json().get("data", [])]
        if rule_ids:
            await client.post(
                "https://api.twitter.com/2/tweets/search/stream/rules",
                headers=HEADERS,
                json={"delete": {"ids": rule_ids}},
            )

    # Add our rules
    await client.post(
        "https://api.twitter.com/2/tweets/search/stream/rules",
        headers=HEADERS,
        json={"add": STREAM_RULES},
    )


async def start_twitter_stream() -> None:
    """
    Connect to Twitter filtered stream and process matching tweets.
    Reconnects with exponential backoff on failure.
    Skipped entirely if TWITTER_BEARER_TOKEN is not set.
    """
    if not config.TWITTER_BEARER_TOKEN:
        print("TWITTER_BEARER_TOKEN not set — Twitter stream disabled")
        return

    backoff = 1
    redis_client = await get_client()

    async with httpx.AsyncClient(timeout=None) as http:
        await _set_rules(http)

        while True:
            try:
                async with http.stream(
                    "GET",
                    "https://api.twitter.com/2/tweets/search/stream?tweet.fields=lang,geo,created_at",
                    headers=HEADERS,
                ) as stream:
                    backoff = 1  # reset on successful connection
                    print("Twitter stream connected")

                    async for line in stream.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                            tweet = data.get("data", {})
                            text = tweet.get("text", "")

                            if not text or await is_duplicate(text, redis_client):
                                continue

                            classification = await asyncio.to_thread(classify_event, text)
                            if classification["confidence"] < 0.3:
                                continue

                            locations = extract_locations(text)
                            if not locations:
                                continue

                            signal = {
                                "event_type": classification["event_type"],
                                "severity": score_severity(text),
                                "title": text[:200],
                                "summary": None,
                                "location": locations[0],
                                "confidence": classification["confidence"],
                                "source_type": "twitter",
                                "timestamp": datetime.now(timezone.utc),
                            }
                            event = build_event([signal])
                            await emit_event(event)

                        except Exception as e:
                            sentry_sdk.capture_exception(e)
                            print(f"Tweet processing error: {e}")

            except Exception as e:
                print(f"Twitter stream disconnected: {e}. Reconnecting in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 300)  # cap at 5 minutes
