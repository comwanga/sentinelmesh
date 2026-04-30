import importlib
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_app():
    """Return the FastAPI app with lifespan side effects neutralised."""
    with patch("main.AsyncIOScheduler"), \
         patch("main.QueueManager"):
        import main
        importlib.reload(main)
        return main.app


def test_health_returns_ok():
    from fastapi.testclient import TestClient
    app = _make_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_health_detailed_returns_queue_depths():
    from fastapi.testclient import TestClient
    import main

    mock_qm = MagicMock()
    mock_qm.get_queue_length = AsyncMock(side_effect=[7, 2])

    app = _make_app()
    main._queue_manager = mock_qm

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/health/detailed")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["queue_depth"]["transcribe_audio"] == 7
    assert body["queue_depth"]["dead_letter"] == 2


def test_health_detailed_when_queue_not_ready():
    from fastapi.testclient import TestClient
    import main

    app = _make_app()
    main._queue_manager = None

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/health/detailed")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "not initialized" in body["reason"]
