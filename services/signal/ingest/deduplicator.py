import hashlib
import redis.asyncio as aioredis

_TTL_SECONDS = 86_400  # 24 hours

async def is_duplicate(content: str, client: aioredis.Redis) -> bool:
    """
    Return True if this content has been seen within the last 24 hours.
    Uses SHA256 of content as the dedup key stored in Redis.
    """
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    key = f"sentinel:dedup:{content_hash}"

    # SET NX (only set if not exists) + EX (expire after 24h)
    is_new = await client.set(key, "1", nx=True, ex=_TTL_SECONDS)
    return not is_new  # is_new is None if key already existed
