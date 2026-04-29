import json
import redis.asyncio as aioredis
import config

# Shared async Redis client — initialised once per process
_client: aioredis.Redis | None = None

async def get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(config.REDIS_URL, decode_responses=True)
    return _client

async def emit_event(event: dict) -> None:
    """Push a SafetyEvent dict to the gateway via Redis pub/sub."""
    client = await get_client()
    await client.publish("sentinel:events:new", json.dumps(event))
