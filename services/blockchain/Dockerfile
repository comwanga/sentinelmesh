# services/blockchain/Dockerfile
FROM rust:1.88-slim AS builder

WORKDIR /app

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY sentinel-core/Cargo.toml sentinel-core/Cargo.toml
COPY blockchain/Cargo.toml blockchain/Cargo.toml

# Stub sources so Cargo can cache dependencies
RUN mkdir -p sentinel-core/src blockchain/src \
    && echo "pub fn _stub() {}" > sentinel-core/src/lib.rs \
    && echo "fn main() {}" > blockchain/src/main.rs \
    && cargo build --release -p blockchain 2>/dev/null || true \
    && rm -rf sentinel-core/src blockchain/src

# Copy real sources
COPY sentinel-core/src sentinel-core/src
COPY blockchain/src blockchain/src

# Force recompile of our crates (touch timestamps)
RUN touch sentinel-core/src/lib.rs blockchain/src/main.rs

# Compile for release
RUN cargo build --release -p blockchain

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y ca-certificates wget && rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 10002 blockchain && \
    useradd --system --uid 10002 --gid blockchain --no-create-home blockchain

COPY --from=builder --chown=blockchain:blockchain /app/target/release/blockchain /usr/local/bin/blockchain

EXPOSE 3003

USER blockchain
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3003/health >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/blockchain"]
