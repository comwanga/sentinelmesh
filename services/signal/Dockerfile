# ============================================================================
# STAGE 1: Builder - Install dependencies and cache them in a layer
# ============================================================================
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build essentials only in builder (won't be in final image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (leverage Docker layer caching)
COPY requirements.txt .

# Create a virtual environment in /build/venv
RUN python -m venv /build/venv
ENV PATH="/build/venv/bin:$PATH"

# Upgrade pip/setuptools/wheel in venv (isolated, won't pollute system)
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install dependencies with --no-cache-dir (saves space in layer)
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy model into venv (will copy in final stage)
RUN python -m spacy download en_core_web_sm

# ============================================================================
# STAGE 2: Runtime - Minimal final image
# ============================================================================
FROM python:3.11-slim

WORKDIR /app

# System dependencies: ffmpeg only (no build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy venv from builder (contains all pip packages)
COPY --from=builder /build/venv /venv
ENV PATH="/venv/bin:$PATH"

# Copy spaCy cache from builder (models already downloaded)
COPY --from=builder /root/.cache/spacy /root/.cache/spacy

# Copy application code
COPY . .

# Create non-root user (security best practice)
RUN useradd -m -u 1000 sentinel && chown -R sentinel:sentinel /app
USER sentinel

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
