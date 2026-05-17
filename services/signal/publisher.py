import json
import logging
from pathlib import Path

import jsonschema
import redis.asyncio as aioredis
import config

logger = logging.getLogger(__name__)

_client: aioredis.Redis | None = None
_schema: dict | None = None
_SCHEMA_PATH = Path(__file__).parent / "event_schema.json"


def _get_schema() -> dict:
    global _schema
    if _schema is None:
        _schema = json.loads(_SCHEMA_PATH.read_text())
    return _schema


async def get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(config.REDIS_URL, decode_responses=True)
    return _client


async def emit_event(event: dict) -> None:
    """Validate against event_schema.json then publish to Redis. Drops invalid events."""
    try:
        jsonschema.validate(instance=event, schema=_get_schema())
    except jsonschema.ValidationError as e:
        logger.warning("dropping event that failed schema validation: %s", e.message)
        return

    client = await get_client()
    await client.xadd(
        "sentinel:events:stream",
        {"payload": json.dumps(event)},
        maxlen=10_000,
        approximate=True,
    )
