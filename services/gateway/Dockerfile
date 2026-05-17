# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.88-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests for all three crates
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

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/gateway /usr/local/bin/gateway

EXPOSE 3000

CMD ["/usr/local/bin/gateway"]
