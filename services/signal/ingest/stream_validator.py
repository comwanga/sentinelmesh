"""Validate that a URL points to a reachable audio stream."""

import logging

import httpx

logger = logging.getLogger(__name__)

# Content-Type prefixes accepted as audio streams.
# Some stations serve audio inside video containers (e.g. video/mp2t).
_AUDIO_PREFIXES = ("audio/", "application/vnd.apple.mpegurl", "video/")


async def validate_stream(url: str) -> bool:
    """
    Return True if url is a reachable audio stream.

    Checks:
    1. HEAD request succeeds (or GET if HEAD returns 405).
    2. Content-Type is audio/*, application/vnd.apple.mpegurl, or video/*.
    3. Times out after 10 seconds.

    On any exception, returns False without raising.
    """
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            response = await client.head(url)

            if response.status_code == 405:
                # Server rejected HEAD — fall back to a streaming GET
                response = await client.get(url)

            if not response.is_success:
                return False

            content_type = response.headers.get("content-type", "")
            return any(content_type.startswith(p) for p in _AUDIO_PREFIXES)

    except Exception as exc:
        logger.debug("validate_stream failed for %s: %s", url, exc)
        return False
