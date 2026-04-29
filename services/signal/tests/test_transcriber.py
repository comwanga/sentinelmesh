import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_segment(text: str):
    seg = MagicMock()
    seg.text = text
    return seg


@pytest.fixture
def job_data():
    return {
        "id": "test-job-123",
        "payload": {
            "stream_id": "citizen_radio",
            "audio_url": "http://fake-stream",
        },
    }


@pytest.mark.asyncio
async def test_process_job_skips_short_transcript(job_data):
    """A transcript under MIN_TRANSCRIPT_CHARS returns status=skipped."""
    segments = [_make_segment("Hi.")]  # 3 chars — below 30-char threshold

    mock_model = MagicMock()
    mock_model.transcribe.return_value = (iter(segments), MagicMock())

    with patch("worker.audio_capture.capture_audio_segment",
               new_callable=AsyncMock, return_value="/tmp/fake.wav"), \
         patch("worker.transcriber.get_client", new_callable=AsyncMock):
        from worker import transcriber
        transcriber.MODEL = mock_model
        result = await transcriber.process_transcription_job(job_data)

    assert result["status"] == "skipped"
    assert result["reason"] == "transcript_too_short"


@pytest.mark.asyncio
async def test_process_job_returns_failed_on_capture_error(job_data):
    """An ffmpeg capture error produces status=failed, not an unhandled exception."""
    with patch("worker.audio_capture.capture_audio_segment",
               new_callable=AsyncMock,
               side_effect=RuntimeError("ffmpeg exit 1")):
        from worker import transcriber
        result = await transcriber.process_transcription_job(job_data)

    assert result["status"] == "failed"
    assert "ffmpeg" in result["error"]


@pytest.mark.asyncio
async def test_process_job_returns_failed_on_transcription_timeout(job_data):
    """A transcription that exceeds TRANSCRIPTION_TIMEOUT produces status=failed."""
    import asyncio

    mock_model = MagicMock()

    async def _timeout_transcribe(*a, **kw):
        raise asyncio.TimeoutError()

    with patch("worker.audio_capture.capture_audio_segment",
               new_callable=AsyncMock, return_value="/tmp/fake.wav"), \
         patch("asyncio.wait_for", side_effect=asyncio.TimeoutError()):
        from worker import transcriber
        transcriber.MODEL = mock_model
        result = await transcriber.process_transcription_job(job_data)

    assert result["status"] == "failed"
    assert "timeout" in result["error"]
