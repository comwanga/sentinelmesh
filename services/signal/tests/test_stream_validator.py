"""Tests for ingest.stream_validator.validate_stream."""

import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch


def _make_response(status_code: int, content_type: str) -> MagicMock:
    """Build a minimal mock httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    type(resp).is_success = PropertyMock(return_value=(200 <= status_code < 300))
    resp.headers = {"content-type": content_type}
    return resp


@pytest.mark.asyncio
async def test_valid_audio_stream_returns_true():
    """HEAD 200 with audio/mpeg Content-Type returns True."""
    mock_response = _make_response(200, "audio/mpeg")

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.head = AsyncMock(return_value=mock_response)

    with patch("ingest.stream_validator.httpx.AsyncClient", return_value=mock_client):
        from ingest.stream_validator import validate_stream
        result = await validate_stream("http://fake-stream/audio")

    assert result is True


@pytest.mark.asyncio
async def test_non_audio_content_type_returns_false():
    """HEAD 200 with text/html Content-Type returns False."""
    mock_response = _make_response(200, "text/html")

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.head = AsyncMock(return_value=mock_response)

    with patch("ingest.stream_validator.httpx.AsyncClient", return_value=mock_client):
        from ingest.stream_validator import validate_stream
        result = await validate_stream("http://fake-stream/page")

    assert result is False


@pytest.mark.asyncio
async def test_connection_error_returns_false():
    """ConnectError during HEAD returns False without raising."""
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.head = AsyncMock(
        side_effect=httpx.ConnectError("connection refused")
    )

    with patch("ingest.stream_validator.httpx.AsyncClient", return_value=mock_client):
        from ingest.stream_validator import validate_stream
        result = await validate_stream("http://unreachable-host/stream")

    assert result is False


@pytest.mark.asyncio
async def test_timeout_returns_false():
    """TimeoutException during HEAD returns False without raising."""
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.head = AsyncMock(
        side_effect=httpx.TimeoutException("timed out")
    )

    with patch("ingest.stream_validator.httpx.AsyncClient", return_value=mock_client):
        from ingest.stream_validator import validate_stream
        result = await validate_stream("http://slow-stream/audio")

    assert result is False


@pytest.mark.asyncio
async def test_head_405_falls_back_to_get():
    """HEAD returning 405 triggers a streaming GET; 200 with audio/mpeg returns True."""
    head_response = _make_response(405, "")
    head_response.is_success = False

    get_response = _make_response(200, "audio/mpeg")

    # Build an async context manager for client.stream(...)
    stream_ctx = AsyncMock()
    stream_ctx.__aenter__ = AsyncMock(return_value=get_response)
    stream_ctx.__aexit__ = AsyncMock(return_value=False)

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.head = AsyncMock(return_value=head_response)
    mock_client.stream = MagicMock(return_value=stream_ctx)

    with patch("ingest.stream_validator.httpx.AsyncClient", return_value=mock_client):
        from ingest.stream_validator import validate_stream
        result = await validate_stream("http://fake-stream/audio")

    assert result is True
    mock_client.stream.assert_called_once_with("GET", "http://fake-stream/audio")


@pytest.mark.asyncio
async def test_video_container_content_type_returns_true():
    """video/mp2t is an accepted container for audio streams."""
    mock_response = _make_response(200, "video/mp2t")

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.head = AsyncMock(return_value=mock_response)

    with patch("ingest.stream_validator.httpx.AsyncClient", return_value=mock_client):
        from ingest.stream_validator import validate_stream
        result = await validate_stream("http://fake-stream/ts")

    assert result is True


@pytest.mark.asyncio
async def test_404_response_returns_false():
    """Non-success status codes other than 405 return False."""
    mock_response = _make_response(404, "audio/mpeg")

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.head = AsyncMock(return_value=mock_response)

    with patch("ingest.stream_validator.httpx.AsyncClient", return_value=mock_client):
        from ingest.stream_validator import validate_stream
        result = await validate_stream("http://fake-stream/gone")

    assert result is False
