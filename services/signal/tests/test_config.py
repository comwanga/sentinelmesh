import importlib
import os
import pytest


def _reload(monkeypatch, extra: dict = {}):
    """Reload config module with a controlled environment."""
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    for k, v in extra.items():
        monkeypatch.setenv(k, v)
    import config
    importlib.reload(config)
    return config


def test_log_level_defaults_to_info(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    import config
    importlib.reload(config)
    assert config.LOG_LEVEL == "INFO"


def test_log_level_reads_from_env(monkeypatch):
    cfg = _reload(monkeypatch, {"LOG_LEVEL": "DEBUG"})
    assert cfg.LOG_LEVEL == "DEBUG"


def test_database_url_optional(monkeypatch):
    """ml-worker must be able to import config without DATABASE_URL set."""
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    import config
    importlib.reload(config)
    assert config.DATABASE_URL == ""


def test_redis_url_required(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    import config
    with pytest.raises(RuntimeError, match="REDIS_URL"):
        importlib.reload(config)
