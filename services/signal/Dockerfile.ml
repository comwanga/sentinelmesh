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
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/venv /venv
ENV PATH="/venv/bin:$PATH"

COPY . .

RUN useradd -m -u 1000 sentinel \
    && chown -R sentinel:sentinel /app \
    && chown -R sentinel:sentinel /venv

USER sentinel

# Worker has no HTTP server — check the process is alive at the OS level
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
    CMD pgrep -f worker.transcriber

CMD ["python", "-m", "worker.transcriber"]
