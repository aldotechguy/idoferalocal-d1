# Test setup runbook — exact order to run every prompt

This is the execution order for the 9 phases in `docs/test-plan.md` **plus** the regression
prompts (R1–R3). Run them top to bottom. Each step has: the prompt to paste, what it produces,
and the **gate** (the command that must be green before you move on). Commit after each step.

---

## Prerequisites (before Step 0)

- [ ] Repo checked out on `feature/unified-mall`; `bun install` (or `npm ci`) done.
- [ ] `npm run lint && npm run test:mall-backend` already green (baseline).
- [ ] Cloudflare access + `npx wrangler login` (needed only from Step 7 / Phase 5).
- [ ] A **read-only** Cloudflare API token (needed only at Step 9 / Phase 7).
- [ ] Preview env exists and is isolated: Worker `idomall-preview`, D1 `idofera-preview`,
      R2 `idomall-preview` (`npx wrangler deploy --env preview`).
- [ ] **Never** set `MALL_CONTRACT_ALLOW_LIVE`, and never target `--env mall` in a test.

---

## The order (one screen)

| Step | Prompt | Produces | Gate |
|---|---|---|---|
| 0 | **Phase 0** | `scripts/test-harness.ts`, `assertNotProduction`, coverage + `test:ci` scripts | `npm run lint && npm run test:mall-backend` green; `npm run coverage` emits a report |
| 1 | **Phase 1** | `scripts/money-invariants.test.ts` | `npm run test:money` green; **100% line+branch** on money modules |
| 2 | **R1** | `scripts/regression/` + `docs/regressions.md` + `test:regression` | `npm run test:regression` green |
| 3 | **R2** | `scripts/regression/money-golden.test.ts` + `__golden__/*.json` | golden suite green; a deliberate type/amount change fails it |
| 4 | **Phase 2** | `scripts/vocabulary-contract.test.ts` | green; a bogus type literal fails it |
| 5 | **Phase 3** | `scripts/money-math.property.test.ts` | green, deterministic with pinned seed |
| 6 | **Phase 4** | `scripts/money-flow.integration.test.ts` | green; Node↔Worker parity assertion passes |
| 7 | **Phase 5** | hardened `scripts/verify-mall-contract.ts` | all checks pass against `idomall-preview` only |
| 8 | **Phase 6** | `vitest` component tests + Playwright E2E | `npm run test:ui` + `npm run test:e2e` green; E2E refuses non-preview host |
| 9 | **Phase 7** | `scripts/verify-prod-reconciliation.ts` (+ cron) | `--dry-run` prints the table; a broken threshold fires a test alert |
| 10 | **Phase 8** | Stryker config | mutation score meets the break threshold on money modules |
| 11 | **R3** | CI jobs | PR gate = Steps 0–6; merge = Step 7; nightly = Step 8; scheduled = Step 9 |

**Order logic:** Step 0 is a hard prerequisite (the harness + prod guard everything else uses).
Steps 1–6 are fast, in-memory, zero-prod-risk — get them into the PR gate first. Step 7 is the
first time you touch a real database (isolated preview). Steps 8–10 are slower/nightly/periodic.
R3 is applied incrementally as each step lands, then formalized at the end.

---

## Step-by-step

### Step 0 — Phase 0 (harness, prod guard, coverage gate)
Paste the **Phase 0** prompt from `docs/test-plan.md`.
Then: `npm run lint && npm run test:mall-backend && npm run coverage`.
Confirm `scripts/test-harness.ts` exports `makeTestDb`, `makeTestExecutor`, `moneyTotals`, and
that `assertNotProduction` throws on `idomall.olz.workers.dev` / `idofera`.
**Commit.** *Everything below depends on this.*

### Step 1 — Phase 1 (money-path invariants) ★
Paste the **Phase 1** prompt. This is the highest-value step; take the time.
Then: `npm run test:money` and `npm run coverage` — paste the per-file table.
**Gate:** the six money modules must show 100% line+branch. **Commit.**

### Step 2 — R1 (regression lock + ledger)
Paste the **R1** prompt. This moves/duplicates the eight audit seeds (F1–F6, N1, N2) into
`scripts/regression/` and creates the ledger.
Then: `npm run test:regression`. **Commit.**

### Step 3 — R2 (golden money suite)
Paste the **R2** prompt. It builds `scripts/regression/money-golden.test.ts` and the committed
`__golden__/` fixtures.
Then: `npm run test:regression`. Prove it bites by temporarily flipping a movement type in
server code, confirm the diff fails, then revert. **Commit** (fixtures included).

### Step 4 — Phase 2 (vocabulary contract)
Paste the **Phase 2** prompt. Then run the new test; confirm a bogus literal fails it. **Commit.**

### Step 5 — Phase 3 (property-based money math)
Paste the **Phase 3** prompt. Then run it with the pinned seed. **Commit.**

### Step 6 — Phase 4 (full-flow integration + parity)
Paste the **Phase 4** prompt. Then run it; confirm the Node↔Worker parity assertion passes.
**Commit.**

### Step 7 — Phase 5 (real D1 / workerd contract — PREVIEW ONLY)
Prereq: `npx wrangler login`, preview env deployed.
Paste the **Phase 5** prompt. Export a preview backup first, then run
`npm run verify:mall-contract`. Confirm it refuses to run against the live origin.
**Commit.**

### Step 8 — Phase 6 (frontend + browser E2E — preview only)
Paste the **Phase 6** prompt. Run `npm run test:ui`, then `npm run test:e2e` against the preview
host only. **Commit.**

### Step 9 — Phase 7 (prod read-only reconciliation monitor)
Prereq: read-only CF API token exported.
Paste the **Phase 7** prompt. Run with `--dry-run` first, verify it prints the reconciliation
table and writes nothing, then test the alert path. Schedule it. **Commit.**

### Step 10 — Phase 8 (mutation testing — stretch)
Paste the **Phase 8** prompt. Run Stryker on the money modules; fix/waive survivors. **Commit.**

### Step 11 — R3 (CI wiring)
Paste the **R3** prompt. Wire: PR gate = Steps 0–6; merge to main = Step 7; nightly = Step 8;
scheduled = Step 9; weekly = Step 10. Fail the build when a golden fixture changes without an
`UPDATE_GOLDEN=1` commit. **Commit.**

---

## Definition of done

- Steps 0–6 green in the PR gate; Step 7 green against preview; Step 8 nightly; Step 9 scheduled.
- 100% line+branch on the money modules; every `MoneyMovementType`/`MovementType`/
  `LiquidAccountType` exercised.
- Every money flow ends in a reconciliation assertion, and the golden suite locks the exact rows.
- Every fixed bug has a `@regression` test and a ledger row.
- **No test ever writes to the production database.**

## Troubleshooting

- *Coverage below 100% on a money module:* the uncovered branch is usually an error/guard path —
  add a test that triggers it rather than excluding the file.
- *Golden suite noisy:* ensure ids/timestamps are replaced with stable placeholders and rows are
  sorted by a stable key before diffing.
- *`verify:mall-contract` refuses to run:* that is correct — point it at the preview origin/DB id
  (`idomall-preview.olz.workers.dev`, D1 `647becf9-e665-4a85-9fa5-dbb5dedbcefa`).
- *E2E hitting production:* the baseURL guard should throw; fix the env var, do not disable it.

