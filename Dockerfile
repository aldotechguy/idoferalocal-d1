# Cloudflare Containers image for the Rust money engine.
#
# `npx wrangler containers build . -t idofera-money-engine:latest` reads a
# Dockerfile from the build context root, which is why the real definition lives
# at native/crates/money_engine_server/Dockerfile and is copied here — one
# definition, two entry points.
#
# The service is std-only Rust (no OpenSSL, no glibc-specific libraries), so a
# musl build on Alpine keeps the image small and avoids runtime library drift.
FROM rust:1.82-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /src
# Copy manifests first so dependency compilation is cached across source edits.
COPY native/Cargo.toml native/Cargo.lock ./native/
COPY native/crates/money_ledger/Cargo.toml ./native/crates/money_ledger/
COPY native/crates/relational_core/Cargo.toml ./native/crates/relational_core/
COPY native/crates/mall_engine/Cargo.toml ./native/crates/mall_engine/
COPY native/crates/money_engine_server/Cargo.toml ./native/crates/money_engine_server/
# The workspace also lists binding_napi; give cargo a manifest for it so the
# workspace resolves, then exclude it from the build.
COPY native/crates/binding_napi/Cargo.toml ./native/crates/binding_napi/
RUN mkdir -p native/crates/binding_napi/src && echo '' > native/crates/binding_napi/src/lib.rs
COPY native/crates/money_ledger/src ./native/crates/money_ledger/src
COPY native/crates/relational_core/src ./native/crates/relational_core/src
COPY native/crates/mall_engine/src ./native/crates/mall_engine/src
COPY native/crates/money_engine_server/src ./native/crates/money_engine_server/src
RUN cargo build --locked --release -p money_engine_server \
 && strip native/target/release/money_engine_server

FROM alpine:3.20
RUN adduser -D -H -u 10001 engine
COPY --from=builder /src/native/target/release/money_engine_server /usr/local/bin/money_engine_server
USER engine
# Cloudflare Containers route traffic to the port the Worker's Container class
# declares (8080); binding 0.0.0.0 is required for the proxy to reach it.
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD \
  wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/money_engine_server"]
