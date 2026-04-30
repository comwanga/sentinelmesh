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

# spaCy model installs into the venv as a package — captured by the venv COPY below
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
    CMD python -c "import httpx, sys; sys.exit(0 if httpx.get('http://localhost:8000/health', timeout=5).status_code == 200 else 1)"

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
