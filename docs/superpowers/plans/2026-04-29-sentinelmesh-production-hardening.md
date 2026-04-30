# SentinelMesh Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all blocking production bugs and build system failures identified in the production audit, including a runtime crash on worker startup, every transcription job failing silently, unbounded queue growth, and a 4 GB Docker build caused by pulling CUDA torch when CPU-only is required.

**Architecture:** Split the signal Dockerfile into API-only (`Dockerfile`) and ML-worker (`Dockerfile.ml`) to shrink the API image from ~4 GB to ~300 MB; replace `openai-whisper + torch` with `faster-whisper` (CTranslate2 backend, no torch dependency, 4–5× faster on CPU); fix audio capture to use an ffmpeg subprocess with frame-safe WAV output instead of a raw byte slice of a live stream; harden the queue with retry and dead-letter; lock all compose services with restart policies and a Whisper model cache volume.

**Tech Stack:** Python 3.11, FastAPI, faster-whisper, spaCy, asyncio, Redis, ffmpeg, Docker multi-stage builds, Docker Compose v3.9

---

## File Map

| File | Action | Reason |
|---|---|---|
| `services/signal/config.py` | Modify | Add `LOG_LEVEL`; make `DATABASE_URL` optional so ml-worker doesn't crash |
| `services/signal/main.py` | Modify | Validate `DATABASE_URL` in lifespan; initialise shared QueueManager; add `/health/detailed` |
| `services/signal/requirements.api.txt` | Create | API-only deps (no ML packages) |
| `services/signal/requirements.ml.txt` | Create | ML worker deps: API deps + faster-whisper |
| `services/signal/requirements.dev.txt` | Create | Test tooling only (pytest) |
| `services/signal/requirements.txt` | Modify | Redirect to `requirements.api.txt` |
| `services/signal/worker/audio_capture.py` | Create | ffmpeg-based frame-safe audio capture |
| `services/signal/worker/transcriber.py` | Modify | Lazy model init, faster-whisper API, timeout, retry handoff |
| `services/signal/queue_manager.py` | Modify | Add `max_retries`/`attempts` tracking, `requeue_failed()`, `datetime.utcnow` → `timezone.utc` |
| `services/signal/Dockerfile` | Modify | API-only image (uses requirements.api.txt, removes dead spaCy COPY) |
| `services/signal/Dockerfile.ml` | Create | ML worker image (uses requirements.ml.txt, process-level HEALTHCHECK) |
| `services/signal/Dockerfile.dev` | Modify | API dev (drop build tools at runtime, add dev reqs) |
| `services/signal/Dockerfile.ml.dev` | Create | ML worker dev |
| `services/signal/.dockerignore` | Create | Exclude pycache, tests, .env from build context |
| `services/gateway/Dockerfile` | Modify | Add `USER node`, add healthcheck |
| `services/gateway/.dockerignore` | Create | Exclude node_modules, dist, .env |
| `docker-compose.yml` | Modify | `restart: unless-stopped`, whisper cache volume, `Dockerfile.ml`, nginx depends_on, ml-worker postgres dep |
| `docker-compose.dev.yml` | Modify | Add `REDIS_URL`/`DATABASE_URL`/`LOG_LEVEL`, point ml-worker to `Dockerfile.ml.dev` |
| `services/signal/tests/test_config.py` | Create | Test `LOG_LEVEL` default and optional `DATABASE_URL` |
| `services/signal/tests/test_audio_capture.py` | Create | Test ffmpeg capture error paths |
| `services/signal/tests/test_transcriber.py` | Create | Test job skip logic and error handling |
| `services/signal/tests/test_queue_manager.py` | Create | Test retry counter and dead-letter routing |
| `services/signal/tests/test_health.py` | Create | Test `/health` and `/health/detailed` responses |

---

## Task 1: Fix config.py — add LOG_LEVEL, make DATABASE_URL optional

**Files:**
- Modify: `services/signal/config.py`
- Modify: `services/signal/main.py`
- Create: `services/signal/tests/test_config.py`

- [ ] **Step 1: Write the failing tests**

```python
# services/signal/tests/test_config.py
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
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd services/signal
python -m pytest tests/test_config.py -v
```
Expected: `AttributeError: module 'config' has no attribute 'LOG_LEVEL'`

- [ ] **Step 3: Replace the body of `services/signal/config.py`**

```python
import os


def require_env(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


REDIS_URL = require_env("REDIS_URL")

# DATABASE_URL: required by the API service but never used by ml-worker.
# The API lifespan validates it is non-empty before accepting traffic.
DATABASE_URL = os.getenv("DATABASE_URL", "")

TWITTER_BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN", "")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

RSS_FEEDS = [
    "https://nation.africa/kenya/rss",
    "https://standardmedia.co.ke/rss/kenya.xml",
    "https://citizentv.co.ke/feed/",
    "https://ntv.co.ke/feed/",
]

RADIO_STREAMS = {
    "citizen_radio": "https://stream.radiojar.com/citizen-radio",
    "radio_maisha":  "https://stream.radiojar.com/radio-maisha",
}

KENYA_BBOX = "33.91,-4.67,41.90,4.62"
```

- [ ] **Step 4: Update the lifespan in `services/signal/main.py` to validate DATABASE_URL**

Replace the existing `lifespan` function with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required for the signal API service")

    scheduler.add_job(poll_rss_feeds, "interval", seconds=60, id="rss")
    scheduler.add_job(monitor_radio, "interval", seconds=30, id="radio")
    scheduler.start()

    if config.TWITTER_BEARER_TOKEN:
        import asyncio
        asyncio.create_task(start_twitter_stream())

    yield

    scheduler.shutdown()
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd services/signal
python -m pytest tests/test_config.py -v
```
Expected: `4 passed`

- [ ] **Step 6: Commit**

```bash
git add services/signal/config.py services/signal/main.py services/signal/tests/test_config.py
git commit -m "fix: add LOG_LEVEL to config, make DATABASE_URL optional for ml-worker"
```

---

## Task 2: Split requirements — remove unused deps, switch to faster-whisper

**What is changing and why:**

| Package | Old state | New state | Reason |
|---|---|---|---|
| `openai-whisper` | prod | removed | replaced by faster-whisper |
| `torch==2.4.1` | prod (~2.5 GB CUDA) | removed | faster-whisper uses CTranslate2, no torch |
| `torchaudio==2.4.1` | prod (~500 MB) | removed | not required by Whisper |
| `faster-whisper` | absent | `requirements.ml.txt` | 4–5× faster on CPU, no CUDA |
| `scikit-learn` | prod | removed | not imported anywhere in the codebase |
| `rq` | prod (unused) | removed | re-implemented via `queue_manager.py`; dead dep |
| `requests` | prod | removed | `httpx` covers all HTTP; `requests` was only in the old healthcheck CMD |
| `pytest`, `pytest-asyncio` | prod | `requirements.dev.txt` | test tooling must not be in production images |

**Files:**
- Create: `services/signal/requirements.api.txt`
- Create: `services/signal/requirements.ml.txt`
- Create: `services/signal/requirements.dev.txt`
- Modify: `services/signal/requirements.txt`

- [ ] **Step 1: Create `services/signal/requirements.api.txt`**

```
# API-layer dependencies only. No ML packages.
# Used by: services/signal/Dockerfile

fastapi==0.115.12
uvicorn[standard]==0.34.0
asyncpg==0.30.0
redis==5.2.1
spacy==3.8.5
langdetect==1.0.9
httpx==0.28.1
feedparser==6.0.11
apscheduler==3.11.0
```

- [ ] **Step 2: Create `services/signal/requirements.ml.txt`**

```
# ML worker dependencies (superset of API deps).
# Used by: services/signal/Dockerfile.ml

-r requirements.api.txt

# Speech-to-text via CTranslate2 — no torch/CUDA required, 4-5x faster than
# openai-whisper on CPU. Verify latest 1.x stable via `pip index versions faster-whisper`
# before updating this pin.
faster-whisper==1.0.3
```

- [ ] **Step 3: Create `services/signal/requirements.dev.txt`**

```
# Test tooling only. Never installed in production images.

pytest==8.3.5
pytest-asyncio==0.25.3
```

- [ ] **Step 4: Replace the body of `services/signal/requirements.txt`**

```
# Redirects to requirements.api.txt.
# For the ML worker image, use requirements.ml.txt.
# For test tooling, use requirements.dev.txt.
-r requirements.api.txt
```

- [ ] **Step 5: Verify API requirements install without any ML packages**

```bash
python -m venv /tmp/test-api-venv && \
  /tmp/test-api-venv/bin/pip install --no-cache-dir -q -r services/signal/requirements.api.txt && \
  /tmp/test-api-venv/bin/pip list | grep -iE "torch|whisper|torchaudio|scikit"
```
Expected: empty output (none of those packages appear)

- [ ] **Step 6: Verify faster-whisper installs and is importable**

```bash
/tmp/test-api-venv/bin/pip install --no-cache-dir -q faster-whisper==1.0.3 && \
  /tmp/test-api-venv/bin/python -c "from faster_whisper import WhisperModel; print('faster-whisper OK')"
```
Expected: `faster-whisper OK`

If `1.0.3` is not on PyPI, run `/tmp/test-api-venv/bin/pip index versions faster-whisper`, pick the latest `1.x` stable, and update `requirements.ml.txt` before continuing.

- [ ] **Step 7: Commit**

```bash
git add services/signal/requirements.api.txt services/signal/requirements.ml.txt \
        services/signal/requirements.dev.txt services/signal/requirements.txt
git commit -m "feat: split requirements api/ml/dev, replace openai-whisper+torch with faster-whisper"
```

---

## Task 3: Fix the transcription pipeline — ffmpeg audio capture + faster-whisper API

Two runtime bugs are fixed here:

1. **`whisper.transcribe(BytesIO(...))`** — `openai-whisper` does not accept `BytesIO`. Every job crashes with `TypeError`.
2. **Raw byte slice of a live MP3/AAC stream** — MP3 frames are not byte-aligned to arbitrary offsets. Slicing 480 KB from the middle of a stream produces a malformed file that ffmpeg cannot decode, yielding garbage or empty transcripts.

The fix: `capture_audio_segment()` runs ffmpeg as a subprocess, lets it handle codec framing, and writes a complete mono 16 kHz WAV segment to a temp file. The faster-whisper model then receives a valid file path.

**Files:**
- Create: `services/signal/worker/audio_capture.py`
- Create: `services/signal/tests/test_audio_capture.py`
- Modify: `services/signal/worker/transcriber.py`
- Create: `services/signal/tests/test_transcriber.py`

- [ ] **Step 1: Write failing tests for `audio_capture.py`**

```python
# services/signal/tests/test_audio_capture.py
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
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd services/signal
python -m pytest tests/test_audio_capture.py -v
```
Expected: `ModuleNotFoundError: No module named 'worker.audio_capture'`

- [ ] **Step 3: Create `services/signal/worker/audio_capture.py`**

```python
"""Frame-safe audio capture from a live radio stream using ffmpeg."""

import asyncio
import os
import tempfile


async def capture_audio_segment(stream_url: str, duration: int = 30) -> str:
    """
    Capture `duration` seconds from a live radio stream into a temp WAV file.

    Runs ffmpeg as a subprocess so it handles MP3/AAC codec framing correctly.
    Raw byte-slicing of a live stream produces corrupt audio because MP3 frames
    don't align to arbitrary byte offsets.

    Output is mono 16 kHz PCM — Whisper's native format, avoiding re-decode overhead.

    Returns the path to the temp file. Caller must delete it after use.
    Raises RuntimeError on ffmpeg failure or timeout.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()

    cmd = [
        "ffmpeg", "-y",
        "-i", stream_url,
        "-t", str(duration),
        "-vn",                   # strip any video stream
        "-acodec", "pcm_s16le",  # raw PCM — unambiguous, no decoder risk
        "-ar", "16000",          # 16 kHz — Whisper's native sample rate
        "-ac", "1",              # mono
        tmp.name,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )

    deadline = duration + 20  # buffer for stream negotiation and codec init
    try:
        await asyncio.wait_for(proc.wait(), timeout=deadline)
    except asyncio.TimeoutError:
        proc.kill()
        _safe_unlink(tmp.name)
        raise RuntimeError(
            f"ffmpeg timed out capturing {stream_url} after {deadline}s"
        )

    if proc.returncode != 0:
        _safe_unlink(tmp.name)
        raise RuntimeError(f"ffmpeg exit {proc.returncode} for {stream_url}")

    return tmp.name


def _safe_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass
```

- [ ] **Step 4: Run audio capture tests**

```bash
python -m pytest tests/test_audio_capture.py -v
```
Expected: `3 passed`

- [ ] **Step 5: Write failing tests for the updated transcriber**

```python
# services/signal/tests/test_transcriber.py
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

    with patch("worker.transcriber.MODEL", mock_model), \
         patch("worker.audio_capture.capture_audio_segment",
               new_callable=AsyncMock, return_value="/tmp/fake.wav"), \
         patch("os.unlink"), \
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
    mock_model.transcribe.side_effect = lambda *a, **kw: (_ for _ in ()).throw(
        asyncio.TimeoutError()
    )

    with patch("worker.transcriber.MODEL", mock_model), \
         patch("worker.audio_capture.capture_audio_segment",
               new_callable=AsyncMock, return_value="/tmp/fake.wav"), \
         patch("os.unlink"):
        from worker import transcriber
        transcriber.MODEL = mock_model
        result = await transcriber.process_transcription_job(job_data)

    assert result["status"] == "failed"
    assert "timeout" in result["error"]
```

- [ ] **Step 6: Run to confirm they fail**

```bash
python -m pytest tests/test_transcriber.py -v
```
Expected: `ImportError` or `AttributeError` because the old transcriber uses the wrong API

- [ ] **Step 7: Replace `services/signal/worker/transcriber.py`**

```python
"""ML Worker: Whisper transcription and NLP pipeline."""

import asyncio
import logging
import os
from datetime import datetime, timezone

import config
from queue_manager import QueueManager
from publisher import emit_event, get_client
from worker.audio_capture import capture_audio_segment, _safe_unlink
from ingest.deduplicator import is_duplicate
from nlp.classifier import classify_event
from nlp.location_extractor import extract_locations
from nlp.severity_scorer import score_severity
from nlp.event_fuser import build_event

logger = logging.getLogger(__name__)

MIN_TRANSCRIPT_CHARS = 30
TRANSCRIPTION_TIMEOUT = 120  # hard ceiling per job in seconds

# Initialised inside worker_loop(), not at module import time.
# This prevents the 1-2 GB model load from happening during test collection
# or if this module is imported for other reasons.
MODEL = None


def _load_model():
    from faster_whisper import WhisperModel
    return WhisperModel(config.WHISPER_MODEL, device="cpu", compute_type="int8")


def _transcribe(model, audio_path: str) -> str:
    """Run faster-whisper synchronously; called via run_in_executor."""
    segments, _ = model.transcribe(
        audio_path,
        language=None,           # auto-detect Swahili or English
        initial_prompt="Kenya news broadcast:",
        vad_filter=True,         # skip silent gaps, reduces false short transcripts
    )
    return " ".join(seg.text for seg in segments).strip()


async def process_transcription_job(job_data: dict) -> dict:
    job_id = job_data["id"]
    payload = job_data["payload"]
    audio_path = None

    try:
        logger.info(f"Processing job {job_id} from {payload.get('stream_id')}")

        # Capture a 30-second, frame-safe WAV segment via ffmpeg
        audio_path = await capture_audio_segment(payload["audio_url"], duration=30)

        # Transcribe with a hard timeout — stuck jobs must not block the loop forever
        loop = asyncio.get_event_loop()
        text = await asyncio.wait_for(
            loop.run_in_executor(None, _transcribe, MODEL, audio_path),
            timeout=TRANSCRIPTION_TIMEOUT,
        )

        if len(text) < MIN_TRANSCRIPT_CHARS:
            logger.info(f"Job {job_id}: transcript too short ({len(text)} chars)")
            return {"status": "skipped", "reason": "transcript_too_short"}

        redis_client = await get_client()
        if await is_duplicate(text, redis_client):
            logger.info(f"Job {job_id}: duplicate")
            return {"status": "skipped", "reason": "duplicate"}

        classification = classify_event(text)
        if classification["confidence"] < 0.4:
            logger.info(f"Job {job_id}: low confidence {classification['confidence']}")
            return {"status": "skipped", "reason": "low_confidence"}

        locations = extract_locations(text)
        if not locations:
            logger.info(f"Job {job_id}: no locations found")
            return {"status": "skipped", "reason": "no_locations"}

        signal = {
            "event_type": classification["event_type"],
            "severity": score_severity(text),
            "title": text[:200],
            "summary": text[:500],
            "location": locations[0],
            "confidence": classification["confidence"],
            "source_type": "radio",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        event = build_event([signal])
        await emit_event(event)

        logger.info(f"Job {job_id}: completed, event emitted")
        return {
            "status": "completed",
            "transcript": text,
            "event_type": classification["event_type"],
            "locations": locations,
        }

    except asyncio.TimeoutError:
        logger.error(f"Job {job_id}: transcription exceeded {TRANSCRIPTION_TIMEOUT}s")
        return {"status": "failed", "error": f"transcription timeout after {TRANSCRIPTION_TIMEOUT}s"}

    except Exception as e:
        logger.exception(f"Job {job_id}: unhandled error")
        return {"status": "failed", "error": str(e)}

    finally:
        if audio_path:
            _safe_unlink(audio_path)


async def worker_loop():
    global MODEL

    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    logger.info(f"Loading Whisper model '{config.WHISPER_MODEL}' ...")
    MODEL = _load_model()
    logger.info("Whisper model ready.")

    queue = QueueManager(config.REDIS_URL)
    await queue.init()
    logger.info("ML Worker started.")

    try:
        while True:
            job_data = await queue.dequeue("transcribe_audio", timeout=5)
            if not job_data:
                continue

            job_id = job_data["id"]
            await queue.update_job(job_id, {
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
            })

            result = await process_transcription_job(job_data)

            if result["status"] == "failed":
                # Retry or send to dead-letter — do not silently discard failures
                await queue.requeue_failed(job_data, result)
            else:
                await queue.update_job(job_id, {
                    "status": result.get("status"),
                    "result": result,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                })

            await queue.publish_result("worker:transcription_complete", {
                "job_id": job_id,
                "status": result.get("status"),
                "transcript": result.get("transcript"),
                "stream_id": job_data["payload"].get("stream_id"),
            })

    except KeyboardInterrupt:
        logger.info("Worker shutting down...")
    finally:
        await queue.close()


if __name__ == "__main__":
    asyncio.run(worker_loop())
```

- [ ] **Step 8: Run transcriber tests**

```bash
python -m pytest tests/test_transcriber.py -v
```
Expected: `3 passed`

- [ ] **Step 9: Commit**

```bash
git add services/signal/worker/audio_capture.py \
        services/signal/worker/transcriber.py \
        services/signal/tests/test_audio_capture.py \
        services/signal/tests/test_transcriber.py
git commit -m "fix: replace BytesIO+openai-whisper with ffmpeg capture+faster-whisper, add transcription timeout"
```

---

## Task 4: Add retry and dead-letter queue to QueueManager

Failed jobs currently disappear silently. This task adds retry-with-counter and a dead-letter queue so failures are inspectable and replayable. Also fixes `datetime.utcnow()` deprecation throughout the file.

**Files:**
- Modify: `services/signal/queue_manager.py`
- Create: `services/signal/tests/test_queue_manager.py`

- [ ] **Step 1: Write failing tests**

```python
# services/signal/tests/test_queue_manager.py
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
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd services/signal
python -m pytest tests/test_queue_manager.py -v
```
Expected: `AttributeError: 'QueueManager' object has no attribute 'requeue_failed'`

- [ ] **Step 3: Replace the body of `services/signal/queue_manager.py`**

```python
"""Redis-backed job queue with retry and dead-letter support."""

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import redis.asyncio as redis


class QueueManager:
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.client: Optional[redis.Redis] = None

    async def init(self):
        self.client = await redis.from_url(self.redis_url, decode_responses=True)

    async def enqueue(
        self,
        task_type: str,
        payload: Dict[str, Any],
        max_retries: int = 3,
    ) -> str:
        assert self.client is not None, "call await qm.init() first"

        job_id = str(uuid.uuid4())
        job_data = {
            "id": job_id,
            "type": task_type,
            "payload": payload,
            "status": "queued",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "attempts": 0,
            "max_retries": max_retries,
        }

        await self.client.rpush(f"queue:{task_type}", json.dumps(job_data))
        await self.client.setex(f"job:{job_id}", 86400, json.dumps(job_data))
        return job_id

    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        assert self.client is not None
        data = await self.client.get(f"job:{job_id}")
        return json.loads(data) if data else None

    async def update_job(self, job_id: str, updates: Dict[str, Any]):
        assert self.client is not None
        job_data = await self.get_job(job_id)
        if not job_data:
            return
        job_data.update(updates)
        await self.client.setex(f"job:{job_id}", 86400, json.dumps(job_data))

    async def dequeue(self, task_type: str, timeout: int = 5) -> Optional[Dict[str, Any]]:
        assert self.client is not None
        result = await self.client.blpop(f"queue:{task_type}", timeout=timeout)
        if not result:
            return None
        return json.loads(result[1])

    async def requeue_failed(self, job_data: Dict[str, Any], error_result: Dict[str, Any]):
        """
        Re-enqueue a failed job if retries remain; otherwise push to dead-letter queue.

        Dead-letter entries are retained for 7 days so ops staff can inspect and replay.
        """
        assert self.client is not None

        attempts = job_data.get("attempts", 0) + 1
        updated = {
            **job_data,
            "attempts": attempts,
            "last_error": error_result.get("error"),
        }

        if attempts <= job_data.get("max_retries", 3):
            updated["status"] = "queued"
            await self.client.rpush(f"queue:{updated['type']}", json.dumps(updated))
            await self.client.setex(f"job:{updated['id']}", 86400, json.dumps(updated))
        else:
            updated["status"] = "dead"
            await self.client.rpush("queue:dead_letter", json.dumps(updated))
            # Keep dead-letter jobs for 7 days for post-mortem and replay
            await self.client.setex(f"job:{updated['id']}", 86400 * 7, json.dumps(updated))

    async def get_queue_length(self, task_type: str) -> int:
        assert self.client is not None
        return await self.client.llen(f"queue:{task_type}")

    async def publish_result(self, channel: str, result: Dict[str, Any]):
        assert self.client is not None
        await self.client.publish(channel, json.dumps(result))

    async def close(self):
        if self.client:
            await self.client.aclose()
```

- [ ] **Step 4: Run queue manager tests**

```bash
python -m pytest tests/test_queue_manager.py -v
```
Expected: `4 passed`

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
python -m pytest tests/ -v
```
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add services/signal/queue_manager.py services/signal/tests/test_queue_manager.py
git commit -m "feat: add retry counter and dead-letter queue to QueueManager, fix utcnow deprecation"
```

---

## Task 5: Separate and fix Dockerfiles + add .dockerignore files

**Files:**
- Modify: `services/signal/Dockerfile`
- Create: `services/signal/Dockerfile.ml`
- Modify: `services/signal/Dockerfile.dev`
- Create: `services/signal/Dockerfile.ml.dev`
- Create: `services/signal/.dockerignore`
- Modify: `services/gateway/Dockerfile`
- Create: `services/gateway/.dockerignore`

- [ ] **Step 1: Create `services/signal/.dockerignore`**

```
__pycache__
*.pyc
*.pyo
.pytest_cache
tests/
.env
*.egg-info
.git
node_modules
```

- [ ] **Step 2: Rewrite `services/signal/Dockerfile` (API only)**

```dockerfile
# ============================================================================
# STAGE 1: Builder
# ============================================================================
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.api.txt .

RUN python -m venv /build/venv
ENV PATH="/build/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.api.txt

# spaCy model installs into the venv as a package — it is captured by the venv COPY below
RUN python -m spacy download en_core_web_sm

# ============================================================================
# STAGE 2: Runtime
# ============================================================================
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/venv /venv
ENV PATH="/venv/bin:$PATH"

COPY . .

RUN useradd -m -u 1000 sentinel \
    && chown -R sentinel:sentinel /app \
    && chown -R sentinel:sentinel /venv

USER sentinel

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/health', timeout=5)" || exit 1

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Create `services/signal/Dockerfile.ml` (ML worker)**

```dockerfile
# ============================================================================
# STAGE 1: Builder
# ============================================================================
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ python3-dev \
    && rm -rf /var/lib/apt/lists/*

# requirements.ml.txt includes -r requirements.api.txt
COPY requirements.api.txt requirements.ml.txt ./

RUN python -m venv /build/venv
ENV PATH="/build/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.ml.txt

RUN python -m spacy download en_core_web_sm

# ============================================================================
# STAGE 2: Runtime
# ============================================================================
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/venv /venv
ENV PATH="/venv/bin:$PATH"

COPY . .

RUN useradd -m -u 1000 sentinel \
    && chown -R sentinel:sentinel /app \
    && chown -R sentinel:sentinel /venv

USER sentinel

# Worker has no HTTP server — verify the process is alive at the OS level
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
    CMD python -c "import sys; sys.exit(0)"

CMD ["python", "-m", "worker.transcriber"]
```

- [ ] **Step 4: Update `services/signal/Dockerfile.dev` (API dev)**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.api.txt requirements.dev.txt ./
RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.api.txt -r requirements.dev.txt
RUN python -m spacy download en_core_web_sm

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

- [ ] **Step 5: Create `services/signal/Dockerfile.ml.dev` (ML worker dev)**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.api.txt requirements.ml.txt requirements.dev.txt ./
RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.ml.txt -r requirements.dev.txt
RUN python -m spacy download en_core_web_sm

COPY . .

CMD ["python", "-m", "worker.transcriber"]
```

- [ ] **Step 6: Update `services/gateway/Dockerfile` — add USER node and healthcheck**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 7: Create `services/gateway/.dockerignore`**

```
node_modules
dist
.env
*.log
coverage
.git
```

- [ ] **Step 8: Verify the API image builds and contains no torch**

```bash
docker build -f services/signal/Dockerfile -t sentinelmesh-signal-api:test services/signal/
docker run --rm sentinelmesh-signal-api:test pip list | grep -iE "torch|whisper"
```
Expected: no output from the grep — neither package is in the API image

- [ ] **Step 9: Verify the ML worker image builds and contains faster-whisper but not torch**

```bash
docker build -f services/signal/Dockerfile.ml -t sentinelmesh-ml-worker:test services/signal/
docker run --rm sentinelmesh-ml-worker:test pip list | grep -iE "torch|faster"
```
Expected: one line matching `faster-whisper`, no line matching `torch`

- [ ] **Step 10: Commit**

```bash
git add services/signal/Dockerfile \
        services/signal/Dockerfile.ml \
        services/signal/Dockerfile.dev \
        services/signal/Dockerfile.ml.dev \
        services/signal/.dockerignore \
        services/gateway/Dockerfile \
        services/gateway/.dockerignore
git commit -m "feat: separate API and ML Dockerfiles, drop build tools from runtime, add USER node, fix .dockerignore"
```

---

## Task 6: Harden Docker Compose files

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Replace `docker-compose.yml`**

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: sentinelmesh
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sentinel -d sentinelmesh"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "REDISCLI_AUTH=${REDIS_PASSWORD} redis-cli ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  gateway:
    build:
      context: ./services/gateway
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  signal:
    build:
      context: ./services/signal
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      SERVICE_NAME: signal-api
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M

  ml-worker:
    build:
      context: ./services/signal
      dockerfile: Dockerfile.ml
    restart: unless-stopped
    env_file: .env
    environment:
      SERVICE_NAME: ml-worker
      # DATABASE_URL comes from .env. ml-worker never queries postgres but shared
      # config.py reads it at import time. Remove once config is split per service.
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    volumes:
      - whisper-cache:/home/sentinel/.cache/whisper
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 3G
        reservations:
          cpus: '1'
          memory: 2G

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      signal:
        condition: service_healthy
      gateway:
        condition: service_healthy

volumes:
  pgdata:
  whisper-cache:
```

- [ ] **Step 2: Replace `docker-compose.dev.yml`**

```yaml
version: '3.9'

# Usage: docker compose -f docker-compose.yml -f docker-compose.dev.yml up
# Overrides prod settings for local development.

services:
  postgres:
    ports:
      - "5432:5432"

  redis:
    ports:
      - "6379:6379"

  gateway:
    build:
      context: ./services/gateway
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
    volumes:
      - ./services/gateway/src:/app/src
    environment:
      NODE_ENV: development
      CHOKIDAR_USEPOLLING: "true"

  signal:
    build:
      context: ./services/signal
      dockerfile: Dockerfile.dev
    ports:
      - "8000:8000"
    volumes:
      - ./services/signal:/app
    environment:
      WHISPER_MODEL: base
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      DATABASE_URL: postgresql://sentinel:${POSTGRES_PASSWORD}@postgres:5432/sentinelmesh
      LOG_LEVEL: DEBUG

  ml-worker:
    build:
      context: ./services/signal
      dockerfile: Dockerfile.ml.dev
    command: python -m worker.transcriber
    volumes:
      - ./services/signal:/app
      - whisper-cache:/root/.cache/whisper
    environment:
      WHISPER_MODEL: base
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      DATABASE_URL: postgresql://sentinel:${POSTGRES_PASSWORD}@postgres:5432/sentinelmesh
      LOG_LEVEL: DEBUG
```

- [ ] **Step 3: Validate both compose files parse correctly**

```bash
docker compose -f docker-compose.yml config > /dev/null && echo "prod OK"
docker compose -f docker-compose.yml -f docker-compose.dev.yml config > /dev/null && echo "dev OK"
```
Expected:
```
prod OK
dev OK
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml
git commit -m "fix: restart policies, whisper model cache volume, separate ML Dockerfile, dev env vars, nginx depends_on"
```

---

## Task 7: Add queue depth to the /health endpoint

The `/health` endpoint returns a static `{"ok": true}`. Adding `/health/detailed` with queue depths lets dashboards and alerting detect a growing backlog before users notice dropped events.

**Files:**
- Modify: `services/signal/main.py`
- Create: `services/signal/tests/test_health.py`

- [ ] **Step 1: Write failing tests**

```python
# services/signal/tests/test_health.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient


def _make_client():
    """Build a test client with scheduler and lifespan side effects neutralised."""
    with patch("main.scheduler", MagicMock()), \
         patch("config.DATABASE_URL", "postgresql://x:x@localhost/db"), \
         patch("config.REDIS_URL", "redis://localhost"):
        import importlib
        import main as m
        importlib.reload(m)
        return TestClient(m.app, raise_server_exceptions=False)


def test_health_returns_ok():
    client = _make_client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_health_detailed_returns_queue_depths():
    client = _make_client()

    mock_qm = MagicMock()
    mock_qm.get_queue_length = AsyncMock(side_effect=[7, 2])

    import main
    main._queue_manager = mock_qm

    response = client.get("/health/detailed")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["queue_depth"]["transcribe_audio"] == 7
    assert body["queue_depth"]["dead_letter"] == 2


def test_health_detailed_when_queue_not_ready():
    client = _make_client()

    import main
    main._queue_manager = None

    response = client.get("/health/detailed")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "not initialized" in body["reason"]
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd services/signal
python -m pytest tests/test_health.py -v
```
Expected: `404 Not Found` for `/health/detailed`

- [ ] **Step 3: Replace `services/signal/main.py`**

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from ingest.rss_parser import poll_rss_feeds
from ingest.twitter_stream import start_twitter_stream
from ingest.radio_transcriber import monitor_radio
from queue_manager import QueueManager
import config

scheduler = AsyncIOScheduler()
_queue_manager: QueueManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _queue_manager

    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required for the signal API service")

    _queue_manager = QueueManager(config.REDIS_URL)
    await _queue_manager.init()

    scheduler.add_job(poll_rss_feeds, "interval", seconds=60, id="rss")
    scheduler.add_job(monitor_radio, "interval", seconds=30, id="radio")
    scheduler.start()

    if config.TWITTER_BEARER_TOKEN:
        import asyncio
        asyncio.create_task(start_twitter_stream())

    yield

    scheduler.shutdown()
    await _queue_manager.close()


app = FastAPI(title="SentinelMesh Signal Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "service": "signal"}


@app.get("/health/detailed")
async def health_detailed():
    """Queue depths for alerting. Alert when transcribe_audio or dead_letter > threshold."""
    if _queue_manager is None:
        return {"ok": False, "reason": "queue not initialized"}

    transcribe_depth = await _queue_manager.get_queue_length("transcribe_audio")
    dlq_depth = await _queue_manager.get_queue_length("dead_letter")

    return {
        "ok": True,
        "service": "signal",
        "queue_depth": {
            "transcribe_audio": transcribe_depth,
            "dead_letter": dlq_depth,
        },
    }
```

- [ ] **Step 4: Run health tests**

```bash
python -m pytest tests/test_health.py -v
```
Expected: `3 passed`

- [ ] **Step 5: Run the full test suite one final time**

```bash
python -m pytest tests/ -v
```
Expected: all tests green across all test files

- [ ] **Step 6: Commit**

```bash
git add services/signal/main.py services/signal/tests/test_health.py
git commit -m "feat: add /health/detailed with transcribe_audio and dead_letter queue depths"
```

---

## Self-Review

### Spec coverage

| Audit finding | Task |
|---|---|
| `config.LOG_LEVEL` AttributeError crash at worker startup | Task 1 |
| `DATABASE_URL` required by ml-worker but never used | Task 1 (optional) + Task 6 (compose env) |
| `torch==2.4.1` pulls CUDA wheels (~2.5 GB) | Task 2 (torch removed entirely) |
| `torchaudio` unnecessary (~500 MB) | Task 2 (removed) |
| `scikit-learn` unused | Task 2 (removed) |
| `rq` in requirements but never imported | Task 2 (removed) |
| `pytest`/`pytest-asyncio` in production image | Task 2 + Task 5 |
| `whisper.transcribe(BytesIO(...))` runtime crash | Task 3 |
| Raw byte slice of live MP3 stream produces corrupt audio | Task 3 (ffmpeg capture) |
| No Whisper model loaded at module import (blocks tests) | Task 3 (lazy init in worker_loop) |
| No transcription timeout | Task 3 (`asyncio.wait_for`) |
| No Whisper model cache volume | Task 6 |
| No `restart: unless-stopped` on any service | Task 6 |
| Dead `COPY /root/.cache/spacy` layer | Task 5 (removed) |
| Health check HTTP-only — breaks for ml-worker | Task 5 (process check for worker) |
| API image carries full ML stack (~4 GB) | Task 5 (separate Dockerfiles) |
| `nginx` missing `depends_on: signal` | Task 6 |
| `ml-worker depends_on` missing postgres | Task 6 |
| No `.dockerignore` | Task 5 |
| `USER node` missing in gateway | Task 5 |
| Dev compose missing `REDIS_URL`/`DATABASE_URL` | Task 6 |
| No queue depth observability | Task 7 |
| `datetime.utcnow()` deprecated | Task 4 (all replaced with `datetime.now(timezone.utc)`) |
| Failed jobs silently dropped | Task 4 (retry + dead-letter) |

### Gaps (intentional follow-ups, not in scope)

- **Worker concurrency** — the loop is still single-threaded (one job at a time). Fixing this requires either running multiple `ml-worker` replicas in compose or implementing an async job-batching strategy. The dead-letter queue now makes the depth visible so the team can decide when to scale.
- **`faster-whisper` version pin** — `1.0.3` is used in requirements.ml.txt. Before building in CI, verify this is available on PyPI with `pip index versions faster-whisper` and update if needed.

### Placeholder scan

None found. Every step contains complete, runnable code.

### Type consistency

- `requeue_failed(job_data: dict, error_result: dict)` is defined in Task 4 and called as `await queue.requeue_failed(job_data, result)` in Task 3 — signatures match.
- `MODEL` is `None` at module scope in Task 3 and assigned inside `worker_loop()` before the first `dequeue` call — no job can run before the model is ready.
- `_queue_manager` is `None` at module scope in Task 7 and assigned inside `lifespan()` before the scheduler starts — `/health/detailed` handles the `None` case explicitly.
