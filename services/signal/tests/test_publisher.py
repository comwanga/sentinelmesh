import json
import pytest
from unittest.mock import AsyncMock, patch

VALID_EVENT = {
    "schema_version": 1,
    "id": "00000000-0000-0000-0000-000000000001",
    "event_type": "FLOOD",
    "severity": "CRITICAL",
    "title": "Flooding downtown",
    "lat": -1.2921,
    "lng": 36.8219,
    "started_at": "2026-01-01T00:00:00+00:00",
    "summary": "Roads impassable",
    "place_name": "CBD",
    "county": "Nairobi",
    "is_active": True,
    "created_at": "2026-01-01T00:00:00+00:00",
}


def _reset_schema_cache():
    import publisher
    publisher._schema = None


@pytest.mark.asyncio
async def test_valid_event_is_published():
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(VALID_EVENT.copy())
    # Events are published to the Redis stream via XADD.
    mock_client.xadd.assert_awaited_once()
    args = mock_client.xadd.call_args[0]
    assert args[0] == "sentinel:events:stream"
    assert json.loads(args[1]["payload"]) == VALID_EVENT


@pytest.mark.asyncio
async def test_missing_required_field_drops_event():
    bad = {k: v for k, v in VALID_EVENT.items() if k != "event_type"}
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(bad)
    mock_client.publish.assert_not_called()


@pytest.mark.asyncio
async def test_extra_field_drops_event():
    bad = {**VALID_EVENT, "extra_field": "not_allowed"}
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(bad)
    mock_client.publish.assert_not_called()


@pytest.mark.asyncio
async def test_null_lat_drops_event():
    bad = {**VALID_EVENT, "lat": None}
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(bad)
    mock_client.publish.assert_not_called()


@pytest.mark.asyncio
async def test_optional_fields_absent_still_publishes():
    event = {k: v for k, v in VALID_EVENT.items()
             if k not in ("summary", "place_name", "county")}
    mock_client = AsyncMock()
    _reset_schema_cache()
    with patch("publisher.get_client", return_value=mock_client):
        import publisher
        await publisher.emit_event(event)
    mock_client.xadd.assert_awaited_once()
