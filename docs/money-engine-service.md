# Serving the Rust money engine

The Mall Worker cannot load a native Node addon, so the Rust engine
(`native/crates/money_engine_server`) runs as a small HTTP service and the
Worker calls it. When it is unreachable, every money check falls back to the
parity-tested TypeScript implementation, so the service is never a single point
of failure.

## Contract

- `GET /health` → `{"ok":true,"result":{"engine":"idofera-rust-money-engine","version":"…","runtime":"rust","auth":"required|open"}}`.
  Public on purpose: the Worker uses it to prove which implementation answers.
- Every other route is `POST` with `Authorization: Bearer $MONEY_ENGINE_TOKEN`
  (required only when the token is set) and answers `{"ok":true,"result":…}` or
  `{"ok":false,"error":…}`.

| Route | Body | Result |
| --- | --- | --- |
| `/orders/transition` | `{from, to}` | `{allowed, isIdempotent, errorMessage}` |
| `/orders/amount-due` | `{totalKobo, paidKobo, status}` | `{amountDueKobo}` |
| `/orders/verify-totals` | `{subtotalKobo, discountKobo, deliveryFeeKobo, totalKobo}` | `{valid, error}` |
| `/ledger/treasury-balances` | `{movements: [{id, type, subtype?, sourceAccount?, destinationAccount?, amount_cents}]}` | balances in naira, computed from integer cents |
| `/relational/plan-upsert` | `{collection, document, now}` | `{statements}` or `{statements:null}` when unsupported |
| `/relational/plan-delete` | `{collection, documentId}` | `{statements}` or `{statements:null}` when unsupported |

Money crosses the wire as integer kobo (`i64` in Rust), never as floats.

## Running it

```powershell
cargo build --manifest-path native/Cargo.toml --release -p money_engine_server
$env:PORT = "8080"; $env:MONEY_ENGINE_TOKEN = "<random-token>"
.\native\target\release\money_engine_server.exe
```

`npm run test:native-engine` builds the binary and runs the HTTP contract test
(`scripts/money-engine-service.test.ts`) against a real process.

## Enabling it in the Worker

1. Host the binary on an always-on Node/Linux host reachable over HTTPS.
2. `npx wrangler secret put --env mall MONEY_ENGINE_TOKEN`
3. Set `MONEY_ENGINE_URL` in `[env.mall.vars]` to that origin and redeploy.
4. Check `https://idomall.olz.workers.dev/api/money-engine/health` reports
   `"mode":"rust-remote"` and the engine `version`.

Roll back by clearing `MONEY_ENGINE_URL` (or the token) and redeploying: the
health endpoint then reports `mode: typescript` and every bridge runs TS.

## Known constraint: Cloudflare Workers subrequest limits

A Worker may not issue a subrequest after any `await`. Checkout and snapshot
writes already await D1 before the money checks run, so those paths deliberately
call the synchronous TypeScript helpers (`calculateAmountDueKoboPure`,
`verifyOrderTotalsSync`, `validateOrderTransitionSync`) instead of the remote
engine. The async engine-backed calls are used where no later I/O is required.

Calling the Rust engine inside the checkout transaction itself requires a
runtime that can run both Node and Rust in-process (for example Cloudflare
Containers, which needs a Workers Paid plan and a Docker image). That is a
hosting decision, not a code change, and is intentionally left unconfigured.
