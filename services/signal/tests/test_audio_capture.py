import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_capture_returns_wav_path():
    """capture_audio_segment returns a path string ending in .wav on success."""
    mock_proc = MagicMock()
    mock_proc.wait = AsyncMock(return_value=0)
    mock_proc.returncode = 0
    mock_proc.kill = MagicMock()

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        from worker.audio_capture import capture_audio_segment
        path = await capture_audio_segment("http://fake-stream", duration=30)

    assert isinstance(path, str)
    assert path.endswith(".wav")


@pytest.mark.asyncio
async def test_capture_raises_on_ffmpeg_nonzero_exit():
    """RuntimeError is raised when ffmpeg exits with a non-zero code."""
    mock_proc = MagicMock()
    mock_proc.wait = AsyncMock(return_value=1)
    mock_proc.returncode = 1
    mock_proc.kill = MagicMock()

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        from worker.audio_capture import capture_audio_segment
        with pytest.raises(RuntimeError, match="ffmpeg exit"):
            await capture_audio_segment("http://fake-stream", duration=30)


@pytest.mark.asyncio
async def test_capture_raises_on_timeout():
    """RuntimeError is raised when ffmpeg hangs past the deadline."""
    async def _hang():
        await asyncio.sleep(9999)

    mock_proc = MagicMock()
    mock_proc.wait = _hang
    mock_proc.returncode = None
    mock_proc.kill = MagicMock()

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        from worker.audio_capture import capture_audio_segment
        with pytest.raises(RuntimeError, match="timed out"):
            await capture_audio_segment("http://fake-stream", duration=1)
