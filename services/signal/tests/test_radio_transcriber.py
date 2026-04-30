"""Tests for ingest.radio_transcriber.monitor_radio."""

import sys
import importlib
import time
import pytest
from unittest.mock import AsyncMock, patch


# conftest.py stubs ingest.radio_transcriber with a MagicMock so that main.py
# can be collected without the full ingest stack. We remove the stub here and
# import the real module so we can exercise the actual logic.
def _load_real_module():
    sys.modules.pop("ingest.radio_transcriber", None)
    return importlib.import_module("ingest.radio_transcriber")


transcriber_module = _load_real_module()


def _reset_module_state():
    """Reset module-level tracking dicts between tests."""
    transcriber_module._failure_counts.clear()
    transcriber_module._last_warned.clear()
    transcriber_module._cooldown_since.clear()


@pytest.fixture(autouse=True)
def clean_state():
    """Ensure each test starts with clean failure/warn state."""
    _reset_module_state()
    yield
    _reset_module_state()


@pytest.fixture
def single_stream(monkeypatch):
    """Patch config.RADIO_STREAMS to a single test stream."""
    monkeypatch.setattr(
        transcriber_module,
        "config",
        type("_Cfg", (), {
            "REDIS_URL": "redis://localhost",
            "RADIO_STREAMS": {"test_station": "http://fake-stream/audio"},
        })(),
    )


@pytest.mark.asyncio
async def test_valid_stream_queues_job(single_stream):
    """When validate_stream returns True, enqueue is called with the correct payload."""
    mock_queue = AsyncMock()
    mock_queue.enqueue = AsyncMock(return_value="job-123")

    with patch.object(transcriber_module, "validate_stream", new_callable=AsyncMock, return_value=True), \
         patch.object(transcriber_module, "get_queue", new_callable=AsyncMock, return_value=mock_queue):
        await transcriber_module.monitor_radio()

    mock_queue.enqueue.assert_called_once()
    call_args = mock_queue.enqueue.call_args
    assert call_args[0][0] == "transcribe_audio"
    payload = call_args[0][1]
    assert payload["stream_id"] == "test_station"
    assert payload["audio_url"] == "http://fake-stream/audio"
    assert "captured_at" in payload


@pytest.mark.asyncio
async def test_invalid_stream_is_skipped(single_stream):
    """When validate_stream returns False, enqueue is not called."""
    mock_queue = AsyncMock()
    mock_queue.enqueue = AsyncMock()

    with patch.object(transcriber_module, "validate_stream", new_callable=AsyncMock, return_value=False), \
         patch.object(transcriber_module, "get_queue", new_callable=AsyncMock, return_value=mock_queue):
        await transcriber_module.monitor_radio()

    mock_queue.enqueue.assert_not_called()


@pytest.mark.asyncio
async def test_failing_stream_increments_failure_count(single_stream):
    """Each validation failure increments _failure_counts for that stream."""
    mock_queue = AsyncMock()
    mock_queue.enqueue = AsyncMock()

    with patch.object(transcriber_module, "validate_stream", new_callable=AsyncMock, return_value=False), \
         patch.object(transcriber_module, "get_queue", new_callable=AsyncMock, return_value=mock_queue):
        await transcriber_module.monitor_radio()

    assert transcriber_module._failure_counts.get("test_station") == 1


@pytest.mark.asyncio
async def test_stream_skipped_after_3_failures(single_stream):
    """A stream with failure_count >= 3 is skipped — validate_stream is not called."""
    transcriber_module._failure_counts["test_station"] = 3
    # Mark cooldown as just started so the window has not expired yet
    transcriber_module._cooldown_since["test_station"] = time.monotonic()

    mock_queue = AsyncMock()

    with patch.object(transcriber_module, "validate_stream", new_callable=AsyncMock) as mock_validate, \
         patch.object(transcriber_module, "get_queue", new_callable=AsyncMock, return_value=mock_queue):
        await transcriber_module.monitor_radio()

    mock_validate.assert_not_called()


@pytest.mark.asyncio
async def test_success_resets_failure_count(single_stream):
    """A successful validation resets _failure_counts to 0."""
    transcriber_module._failure_counts["test_station"] = 2

    mock_queue = AsyncMock()
    mock_queue.enqueue = AsyncMock(return_value="job-456")

    with patch.object(transcriber_module, "validate_stream", new_callable=AsyncMock, return_value=True), \
         patch.object(transcriber_module, "get_queue", new_callable=AsyncMock, return_value=mock_queue):
        await transcriber_module.monitor_radio()

    assert transcriber_module._failure_counts.get("test_station") == 0


@pytest.mark.asyncio
async def test_cooled_down_stream_retried_after_window(single_stream, monkeypatch):
    """A cooled-down stream is re-admitted once _COOLDOWN_RESET_SECONDS has elapsed."""
    transcriber_module._failure_counts["test_station"] = 3
    # Simulate cooldown started long ago (> 300s)
    transcriber_module._cooldown_since["test_station"] = time.monotonic() - 400

    mock_queue = AsyncMock()
    mock_queue.enqueue = AsyncMock(return_value="job-789")

    with patch.object(transcriber_module, "validate_stream", new_callable=AsyncMock, return_value=True), \
         patch.object(transcriber_module, "get_queue", new_callable=AsyncMock, return_value=mock_queue):
        await transcriber_module.monitor_radio()

    # Failure count reset and job queued
    assert transcriber_module._failure_counts.get("test_station") == 0
    mock_queue.enqueue.assert_called_once()
