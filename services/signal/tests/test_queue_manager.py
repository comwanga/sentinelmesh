import json
import pytest
from unittest.mock import AsyncMock
from queue_manager import QueueManager


def _make_job(attempts: int = 0, max_retries: int = 3) -> dict:
    return {
        "id": "job-abc",
        "type": "transcribe_audio",
        "payload": {"audio_url": "http://stream"},
        "status": "running",
        "attempts": attempts,
        "max_retries": max_retries,
        "created_at": "2026-01-01T00:00:00+00:00",
    }


@pytest.mark.asyncio
async def test_enqueue_sets_attempts_zero_and_max_retries():
    """Newly enqueued jobs start with attempts=0 and max_retries=3."""
    qm = QueueManager("redis://localhost")
    qm.client = AsyncMock()
    qm.client.rpush = AsyncMock()
    qm.client.setex = AsyncMock()

    job_id = await qm.enqueue("transcribe_audio", {"audio_url": "http://stream"})

    stored_json = qm.client.setex.call_args[0][2]
    stored = json.loads(stored_json)
    assert stored["attempts"] == 0
    assert stored["max_retries"] == 3
    assert stored["id"] == job_id


@pytest.mark.asyncio
async def test_requeue_failed_retries_when_below_limit():
    """Jobs with remaining retries go back on the queue with incremented attempts."""
    qm = QueueManager("redis://localhost")
    qm.client = AsyncMock()
    qm.client.rpush = AsyncMock()
    qm.client.setex = AsyncMock()
    qm.client.get = AsyncMock(return_value=json.dumps(_make_job(attempts=0)))

    job = _make_job(attempts=0)
    await qm.requeue_failed(job, {"error": "ffmpeg exit 1"})

    requeued_json = qm.client.rpush.call_args[0][1]
    requeued = json.loads(requeued_json)
    assert requeued["attempts"] == 1
    assert requeued["status"] == "queued"


@pytest.mark.asyncio
async def test_requeue_failed_sends_to_dlq_when_exhausted():
    """Jobs that exhaust retries go to queue:dead_letter, not back on queue:type."""
    qm = QueueManager("redis://localhost")
    qm.client = AsyncMock()
    qm.client.rpush = AsyncMock()
    qm.client.setex = AsyncMock()
    qm.client.get = AsyncMock(return_value=json.dumps(_make_job(attempts=3)))

    job = _make_job(attempts=3)
    await qm.requeue_failed(job, {"error": "timeout"})

    queue_key = qm.client.rpush.call_args[0][0]
    dlq_job = json.loads(qm.client.rpush.call_args[0][1])
    assert queue_key == "queue:dead_letter"
    assert dlq_job["status"] == "dead"
    assert dlq_job["attempts"] == 4


@pytest.mark.asyncio
async def test_requeue_failed_stores_last_error():
    """The error message from the failed result is stored on the job."""
    qm = QueueManager("redis://localhost")
    qm.client = AsyncMock()
    qm.client.rpush = AsyncMock()
    qm.client.setex = AsyncMock()
    qm.client.get = AsyncMock(return_value=json.dumps(_make_job(attempts=0)))

    job = _make_job(attempts=0)
    await qm.requeue_failed(job, {"error": "ffmpeg exit 1"})

    stored = json.loads(qm.client.rpush.call_args[0][1])
    assert stored["last_error"] == "ffmpeg exit 1"
