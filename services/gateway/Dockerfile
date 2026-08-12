# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.88-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests and compile-time assets
COPY event_schema.json ./
COPY Cargo.toml Cargo.lock ./
COPY sentinel-core/Cargo.toml sentinel-core/Cargo.toml
COPY blockchain/Cargo.toml blockchain/Cargo.toml
COPY gateway/Cargo.toml gateway/Cargo.toml

# Stub sources so Cargo can cache dependencies
RUN mkdir -p sentinel-core/src blockchain/src gateway/src && \
    echo "pub fn _stub() {}" > sentinel-core/src/lib.rs && \
    echo "fn main() {}" > blockchain/src/main.rs && \
    echo "fn main() {}" > gateway/src/main.rs && \
    cargo build --release -p gateway 2>/dev/null || true && \
    rm -rf sentinel-core/src blockchain/src gateway/src

# Copy real sources
COPY sentinel-core/src sentinel-core/src
COPY blockchain/src blockchain/src
COPY gateway/src gateway/src

# Force recompile of our crates (touch timestamps)
RUN touch sentinel-core/src/lib.rs blockchain/src/main.rs gateway/src/main.rs

# Compile for release
RUN cargo build --release -p gateway

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y ca-certificates wget && rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 10001 gateway && \
    useradd --system --uid 10001 --gid gateway --no-create-home gateway

COPY --from=builder --chown=gateway:gateway /app/target/release/gateway /usr/local/bin/gateway

EXPOSE 3000

USER gateway
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/ready >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/gateway"]
