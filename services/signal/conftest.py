import os
import pytest

# Set required env vars before any module import so config.py doesn't raise
# during test collection. The transcriber and other modules import config at
# module level, which triggers require_env("REDIS_URL") immediately.
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")


@pytest.fixture(scope="session")
def event_loop_policy():
    import asyncio
    return asyncio.DefaultEventLoopPolicy()
