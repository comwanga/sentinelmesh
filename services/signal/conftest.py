import os
import sys
from unittest.mock import MagicMock
import pytest

# Set required env vars before any module import so config.py doesn't raise
# during test collection. The transcriber and other modules import config at
# module level, which triggers require_env("REDIS_URL") immediately.
# Use a non-routable address so QueueManager.init() fails immediately in tests,
# allowing the lifespan to leave _queue_manager = None.
os.environ.setdefault("REDIS_URL", "redis://0.0.0.1:6379/0")
# DATABASE_URL must be set so the lifespan passes its presence check.
os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")

# Stub heavy optional deps so main.py can be imported without spacy or the
# full ingest stack installed in the local test environment.
# These stubs are replaced by real implementations inside Docker.
for _mod in (
    "spacy",
    "ingest.rss_parser",
    "ingest.twitter_stream",
    "ingest.radio_transcriber",
):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()


@pytest.fixture(scope="session")
def event_loop_policy():
    import asyncio
    return asyncio.DefaultEventLoopPolicy()
