# Cloudflare Containers: Rust money engine
# ========================================
#
# Status: **code-complete, not deployed.** Enabling the container changes how the
# production Worker is built and deployed, so it is gated on one local
# prerequisite (Docker) and one account prerequisite (Containers enabled).
#
# Enabling, once `docker info` succeeds on the deploy machine:
#
#   1. Uncomment the "container hosting" block at the end of wrangler.toml.
#      (It is commented out so a machine without Docker can still deploy the
#      Worker normally — wrangler fails the whole deploy if it cannot build the
#      image, which would otherwise block every unrelated release.)
#   2. npx wrangler deploy --env mall
#      Wrangler builds ./Dockerfile, pushes it, and deploys the Worker with the
#      MONEY_ENGINE_CONTAINER Durable Object binding.
#   3. curl https://idomall.olz.workers.dev/api/money-engine/health
#      Expect `"mode":"rust-remote"`, `"engine":{"engine":"idofera-rust-money-engine",...}`.
#
# Rollback: comment the block out again and redeploy. The binding disappears,
# `/api/money-engine/health` reports `mode: typescript`, and every bridge falls
# back to the parity-tested TypeScript implementation.
#
# Why the block is commented rather than active: as of 2026-10-20 this machine
# has no Docker CLI (`wrangler containers build` → "The Docker CLI could not be
# launched"), and Cloudflare rejected `wrangler containers list` with
# "cannot be used without enabling Containers" for this account. Committing an
# active container config would make production undeployable from here.
#
# Contract: see money-engine-service.md for routes and payloads. The container
# transport is covered by scripts/money-engine-container.test.ts, which drives
# the Worker client through a stand-in binding, and by
# scripts/money-engine-service.test.ts, which runs the real Rust binary.
