# Test Setup Plan — Idofera production codebase

**Scope:** the unified POS + Business-Management + Mall ecosystem (Cloudflare Worker `idomall`
+ D1 `idofera` + R2 `idomall`, Node twin `server.ts`, React SPA).
**Goal:** maximum bug-catching value, money paths at full coverage, without ever risking the
production database.

---

## 0. Ground rules (read first — the DB is live)

1. **Everything automated runs against throwaway SQL.** Local suites use an in-memory
   `node:sqlite` DB seeded by `ensureRelationalSchemaNode()`. No local test may open
   `idofera`, `idofera-d1`, or hit `idomall.olz.workers.dev` for a write.
2. **The only place tests may write to a real D1 is the isolated preview** — Worker
   `idomall-preview`, D1 `idofera-preview`, R2 `idomall-preview` (`--env preview` in
   `wrangler.toml`). Never `--env mall`.
3. **A hard guard, not a convention.** Any code path that can reach a remote D1 must call
   `assertNotProduction(target)` first; it throws on the production host / database id.
   `verify:mall-contract` already refuses live unless `MALL_CONTRACT_ALLOW_LIVE=1` — keep
   that, and never set it in CI.
4. **Back up before any preview schema migration:** `npx wrangler d1 export idofera-preview
   --remote --output backups/idofera-preview-<date>.sql`.
5. **Production checks are read-only** and use a read-only API token.
6. **Reuse the existing stack** (`node:test` via `tsx`, `node:sqlite`) for the backend; add
   new frameworks only where they earn their weight.

---

## 1. Priority order at a glance

| # | Test type | Framework | Why here | Prod risk |
|---|---|---|---|---|
| 0 | Test harness + prod guard + coverage gate | `node:test` + `node:sqlite` + `c8` | Every later step depends on it | none |
| 1 | **Money-path invariant suite** | `node:test` + `node:sqlite` | Highest bug-catching value; catches the audit's exact bug class (unpaired/misclassified money movements, stock drift) | none |
| 2 | Vocabulary / contract tests | `node:test` | Cheapest catch of classification drift (F1/F3 class) | none |
| 3 | Property-based money-math | `fast-check` | Arithmetic edge cases (rounding, floors, caps) | none |
| 4 | Full-flow integration + Node↔Worker parity | `node:test` + D1-shaped binding | Cross-layer propagation correctness | none |
| 5 | Real D1/workerd launch contract | existing `verify:mall-contract` (+ optional `@cloudflare/vitest-pool-workers`) | Platform semantics: atomic batches, triggers, D1 limits | **isolated preview only** |
| 6 | Frontend component + browser E2E | `vitest` + Testing Library + `jsdom`; Playwright | UI/UX money regressions | **preview only** |
| 7 | Production read-only reconciliation monitor | scheduled Worker (cron) or GitHub Action | Ongoing safety net; alerts on drift | **read-only** |
| 8 | Mutation testing on money modules (stretch) | `Stryker` | Proves the money tests actually bite | none |

**CI shape:** PR gate = phases 0–4 (fast, in-memory). On merge to main = phase 5 (preview).
Nightly = phase 6 (browser). Scheduled (every 15–60 min) = phase 7 (prod, read-only).

---

## 2. Money-critical paths — the full-coverage target

Cover **every** path below; each scenario must end with a *reconciliation invariant*
assertion, not just an HTTP status.

| Path | Key DB effects to assert |
|---|---|
| POS sale (Cash / Card / Mobile / Bank / Split) | `sales` + `sale_items`; `products.stock_qty` −; `stock_movements` `Outgoing`; **one `Sale Inflow` per channel** with correct `dest_account`; customer LTV/bump; revision bump |
| POS refund (full/partial, Cash/Biz, `returnStock` T/F) | sale → `Refunded`; `sale_items.returned_qty`; stock restore + `Returned` movement; **`Sale Refund`** movement; customer clawback |
| Store credit | `customers.outstanding_balance_kobo` +; **no liquid inflow** |
| Mall checkout | stock −; `Outgoing` movement; `mall_orders` pending; cart cleared; idempotent replay; oversell abort |
| Mall payment (`collect`/`verify`) | mirrored sale (`Completed`, `is_historical=0`); **`Sale Inflow`**; payment paid; customer create/enrich |
| Mall dispatch | `delivery_orders`; Logistics `expenses`; **`Expense Outflow`** (cash) |
| Mall refund | `Sale Refund`; stock restore; **expense + its `Expense Outflow` voided**; customer clawback |
| Mall cancel / unpaid expiry | stock release + `Returned`; payment cancelled |
| Expense add / delete | `Expense Outflow` created; **reversed on delete** |
| Purchase receive / GRN variance | stock +; `Incoming` movement; cost update; supplier balance |
| Supplier payment | `Supplier Payment` movement; supplier balance − |
| Customer debt payment | `Customer Debt Payment` movement; customer balance − |
| Treasury transfer / owner drawing / repayment | per-account balance math; repayment netting |
| Historical (`is_historical=1`) sale/expense | **must not touch treasury** |

### Coverage bar
- **100% line + branch** on: `src/server/mallApi.ts`, `mallOrderAdminApi.ts`,
  `mallOperations.ts`, `relationalMapper.ts`, `relationalWrites.ts`, `relationalWritesCore.ts`,
  and the money functions in `src/context/AppContext.tsx`.
- Every member of `MoneyMovementType` and `MovementType` exercised at least once; every
  `LiquidAccountType` exercised.
- Every flow's reconciliation invariant asserted (see Phase 1).

---

## Phase 0 — Test harness, production guard, coverage gate

**Type:** infrastructure · **Framework:** `node:test` + `node:sqlite` (already used) + `c8`
**Why first:** every other phase depends on a fixture that physically cannot touch prod, and
on a coverage gate that makes "money paths at full coverage" enforceable.

**Copy-paste prompt**
```
Set up a production-safe test harness for the Idofera repo (root = repo root).

Context you must reuse (do not reinvent):
- Backend tests run with node:test via tsx; the existing suites are
  scripts/mall-backend.test.ts and scripts/mall-safety.test.ts (npm run test:mall-backend).
- The schema bootstrap is ensureRelationalSchemaNode(db) and the executor factory is
  makeNodeMallExecutor(db) in src/server/nodeAdapter.ts.
- Handlers: handleMallApi (src/server/mallApi.ts), handleStaffMallApi
  (src/server/mallOrderAdminApi.ts), runMallMaintenance + mallReadiness
  (src/server/mallOperations.ts), revisionBumpStatement (src/server/mallSafety.ts).

Do:
1. Create scripts/test-harness.ts exporting:
   - makeTestDb(): new in-memory DatabaseSync(':memory:') + ensureRelationalSchemaNode(db).
   - makeTestExecutor(db) -> makeNodeMallExecutor(db).
   - seedCatalog(db, products) and seedActiveCart(db, session, lines) helpers.
   - moneyTotals(db): returns { salesTotalKobo, saleInflowKobo, saleRefundKobo,
     expenseOutflowKobo, liquidByAccount } computed from the relational tables.
2. Add assertNotProduction(target): throw if target contains 'idomall.olz.workers.dev',
   'idofera' (exact D1 name), or database id '3e95a550-a091-490b-819d-f0acb7ea8dd8'.
   Any helper that talks to a remote D1 must call it first.
3. Add npm scripts:
   - "test:money": "tsx --test scripts/money-*.test.ts"
   - "coverage": "c8 --all --include=src/server/** --include=src/context/** --reporter=text
     --reporter=lcov --report-dir=coverage npm run test:money"
   - "test:ci": "npm run lint && npm run test:mall-backend && npm run test:access && npm run test:frontend && npm run test:money"
4. Install devDeps: c8, fast-check, vitest, @testing-library/react, @testing-library/jest-dom,
   jsdom, @playwright/test, @cloudflare/vitest-pool-workers.
5. Add a trivial smoke test scripts/harness.smoke.test.ts that builds the DB via the harness,
   seeds one product, runs a checkout, and asserts moneyTotals() returns finite numbers.

Constraints: never point anything at production; all local tests are in-memory.
Run `npm run lint` and `npm run test:mall-backend` to confirm the existing suites stay green.
```

**Acceptance:** harness + guard + scripts + deps merged; `npm run test:ci` green; a coverage
report is produced.


---

## Phase 1 — Money-path invariant suite  ★ highest value

**Type:** unit + integration (in-memory SQL) · **Framework:** `node:test` + `node:sqlite`
**Why here:** it is fast, deterministic, zero-prod-risk, and it catches the exact class of
bugs this audit found — money movements that are unpaired, misclassified, or leave stock and
the ledger out of sync. Nothing else catches as many high-severity bugs per minute of CI.

**Copy-paste prompt**
```
Write a full-coverage money-path invariant suite at scripts/money-invariants.test.ts using
node:test and the harness from scripts/test-harness.ts. Do not touch any remote database.

Cover EVERY path in this list, driving the real handlers (handleMallApi, handleStaffMallApi,
runMallMaintenance, and the POS money actions):
POS sale (Cash/Card/Mobile/Bank/Split), POS refund (full+partial, Cash/Biz, returnStock
true/false), store credit, mall checkout, mall payment, mall dispatch, mall refund,
mall cancel, unpaid expiry, expense add, expense delete, purchase receive, supplier payment,
customer debt payment, treasury transfer, owner drawing, owner repayment, and a historical
(is_historical=1) sale and expense.

After EACH scenario assert the reconciliation invariants (write them as reusable helpers in
the harness so every test calls them):
1. Per product: products.stock_qty == openingStock + SUM(signed stock_movements.qty).
2. Every non-historical Completed sale has exactly one 'Sale Inflow' set whose SUM ==
   sale.total_kobo; a refund adds a 'Sale Refund' whose amount == refunded amount.
3. Every non-historical expense has exactly one 'Expense Outflow' with amount == expense
   amount, and it is reversed (deleted or zeroed) on expense delete / mall refund.
4. Per liquid account: balance == SUM(signed money_movements by source/dest account).
5. Every money_movements.type is in MoneyMovementType; every source/dest account is in
   {'Biz Account','Physical Cash'} or null.
6. Mall dispatch creates the Logistics expense AND its 'Expense Outflow'; mall refund voids
   BOTH.
7. Historical sale/expense produce zero money_movements.

Also assert idempotency: replaying checkout / collect-payment / refund creates no duplicates
(COUNT of sales, sale_items, money_movements unchanged).

Acceptance: 100% line+branch on src/server/mallApi.ts, mallOrderAdminApi.ts, mallOperations.ts,
relationalMapper.ts, relationalWrites.ts, relationalWritesCore.ts. Run `npm run coverage` and
paste the per-file table; fail CI if any of those files is below 100%.
```

**Acceptance:** suite green, coverage report shows 100% on the money modules.


---

## Phase 2 — Vocabulary / contract tests

**Type:** static + unit contract · **Framework:** `node:test`
**Why here:** the audit's highest-severity bug (F1) was a *string* — a refund written as
`Refund Outflow` instead of `Sale Refund`. A 20-line test makes that class of drift
impossible, for almost no cost.

**Copy-paste prompt**
```
Add scripts/vocabulary-contract.test.ts (node:test). It must fail the build on any
out-of-vocabulary money or stock literal.

1. Read src/types/index.ts and extract the canonical unions: MoneyMovementType,
   MovementType, LiquidAccountType.
2. Scan src/server/**, src/context/AppContext.tsx, and src/shared/** for money-movement type
   literals (INSERT INTO money_movements ... 'X' and `type: 'X'`) and stock-movement type
   literals (INSERT INTO stock_movements ... 'X'), plus liquid-account literals
   ('Biz Account' / 'Physical Cash').
3. Assert every literal is a member of its union. Allow a single explicit whitelist entry for
   the legacy 'Refund Outflow' (kept only for backward-compatible reads of pre-fix rows).
4. Assert specifically: the POS refund and the Mall refund both emit 'Sale Refund'; the Mall
   checkout emits 'Outgoing'; mall dispatch emits 'Expense Outflow'; mall payment emits
   'Sale Inflow'.
5. Assert the union members are non-empty and that 'Refund Outflow' is NOT produced by any
   writer (only read).

Acceptance: `tsx --test scripts/vocabulary-contract.test.ts` green, and deliberately changing
a writer to a bogus type makes it fail.
```

---

## Phase 3 — Property-based money math

**Type:** property/fuzz · **Framework:** `fast-check` + `node:test`
**Why here:** money arithmetic (kobo conversion, floors, caps, rounding) has edge cases that
example-based tests miss. Property tests explore them automatically and shrink failures.

**Copy-paste prompt**
```
Add scripts/money-math.property.test.ts using fast-check + node:test.

Properties (each with fc.assert(fc.property(...))):
1. naira -> kobo -> naira round-trips exactly for any 2-decimal value (use integers of kobo).
2. The Mall effective price is never below products.min_selling_price_kobo, and the wholesale
   tier applies only when qty >= min_wholesale_qty AND it strictly beats the effective price
   AND clears the floor.
3. For any cart: order.total_kobo == subtotal - discount + delivery_fee, and no total is
   negative; the server-resolved line price ignores any client-sent price.
4. Caps hold: total <= 1_000_000_000 kobo, <= 100 lines, <= 1000 units/line; violations are
   rejected (not clamped silently).
5. Partial refunds: 0 <= refunded <= paid; refunded + remaining == total.
6. sync-from-pos: any (items, discount, delivery) with a total that disagrees with
   subtotal - discount + delivery by more than 100 kobo is rejected.

Use a fixed seed in CI for reproducibility; 10_000 runs locally. Never touch a remote DB.
Acceptance: suite green and deterministic with the pinned seed.
```


---

## Phase 4 — Full-flow integration + Node↔Worker parity

**Type:** integration · **Framework:** `node:test` + the D1-shaped binding
**Why here:** it proves information propagates across *all* layers (mall → POS → finance →
analytics) and that the two runtimes cannot drift apart — the core "one system" claim.

**Copy-paste prompt**
```
Add scripts/money-flow.integration.test.ts (node:test). Reuse the D1-shaped binding pattern
already in scripts/mall-backend.test.ts so each scenario runs against BOTH the Node runtime
and the real Worker fetch handler.

Scenarios (run each end-to-end, then assert a final reconciliation):
A. Mall: checkout -> confirm -> collect-payment -> dispatch -> complete -> refund(returnStock
   true and false). Assert buyer-visible /api/mall/orders totals/status match the staff order,
   the mirrored sale, the money movements and the stock ledger.
B. POS: record sale -> edit invoice -> refund -> delete. Assert treasury, reports inputs and
   customer ledger stay consistent at each step.
C. Purchase: place PO -> receive (partial + GRN variance) -> supplier payment. Assert stock,
   Incoming movements, cost update and supplier balance.
D. Expiry: create an unpaid order older than MALL_UNPAID_EXPIRY_HOURS, run the sweep, assert
   stock released + Returned movement + order cancelled.
E. POS<->Mall reverse sync: edit/refund a mall-originated sale in the POS, assert the mall
   order and the buyer page converge (syncFromPos), and that a mismatched total is rejected.

Parity: for scenario A, capture money_movements/sales/stock_movements rows from BOTH runtimes
and assert they are identical (same types, accounts, amounts, counts).

Acceptance: suite green; no scenario leaves an invariant broken; parity assertion passes.
```

---

## Phase 5 — Real D1 / workerd launch contract (ISOLATED PREVIEW ONLY)

**Type:** deployed contract/E2E · **Framework:** existing `scripts/verify-mall-contract.ts`
(keep it) — optionally add `@cloudflare/vitest-pool-workers` for deeper workerd integration.
**Why here:** in-memory SQLite cannot prove D1 batch atomicity, the oversell trigger, or D1
statement limits. This is the only layer that can.

**Copy-paste prompt**
```
Harden and extend the deployed preview contract checks. HARD RULE: target only the isolated
preview — Worker idomall-preview, D1 idofera-preview, R2 idomall-preview (wrangler --env
preview). Never idomall / idofera.

1. In scripts/verify-mall-contract.ts (and any new worker test), add a startup assertion that
   refuses to run unless the base URL host ends with 'idomall-preview.olz.workers.dev' and the
   D1 id equals 647becf9-e665-4a85-9fa5-dbb5dedbcefa. Keep MALL_CONTRACT_ALLOW_LIVE unset.
2. Before running, export a backup: npx wrangler d1 export idofera-preview --remote --output
   backups/idofera-preview-$(date +%F).sql.
3. Cover: cold-start schema bootstrap; max cart (100 lines x 1000 units) committing atomically;
   checkout idempotent replay; stock decrement + Outgoing movement; payment -> mirrored sale +
   Sale Inflow; dispatch -> Logistics expense + Expense Outflow; refund -> Sale Refund + stock
   restore + expense/outflow void; a final reconciliation snapshot (sales vs Sale Inflow,
   stock vs movements, liquid balance vs account movements).
4. Print a pass/fail table and exit non-zero on any mismatch.

Acceptance: all checks pass against idomall-preview; the live origin is never contacted.
```


---

## Phase 6 — Frontend component + browser E2E (preview only)

**Type:** component + E2E · **Framework:** `vitest` + `@testing-library/react` + `jsdom`;
`Playwright` for E2E.
**Why here:** lower money-bug density than the backend, but it catches UI regressions that
misstate money (wrong totals, wrong refund options) and broken cross-page flows.

**Copy-paste prompt**
```
Add frontend tests in two layers.

A. Component tests (vitest + @testing-library/react + jsdom), colocated under src/**:
   - Mall cart totals + checkout validation (phone, name, delivery zone).
   - Mall order tracking renders the amended total/status from the API payload.
   - Refund modal: partial vs full, returnStock toggle, computed refund amount.
   - Expense form -> money movement side effect (mock the context).
   - Treasury balance cards reflect the account-based money movements.
   Mock the API clients (src/services/*) — no network.

B. Playwright E2E against the PREVIEW host only (baseURL from an env var, default the
   idomall-preview origin; assert the host is not idomall.olz.workers.dev before any test):
   - Shopper: browse -> search -> product -> cart -> checkout -> order tracking shows the
     pending order.
   - Staff: entrance -> mall order -> collect payment -> dispatch -> refund; then assert the
     buyer page reflects the same total/status.

Wire: "test:ui": "vitest run", "test:e2e": "playwright test". Never run Playwright against
production. Add both to CI as a nightly job.
Acceptance: suites green; E2E refuses to start against a non-preview host.
```

---

## Phase 7 — Production read-only reconciliation monitor

**Type:** observability · **Framework:** scheduled Worker (cron) or GitHub Action + read-only
D1 API token; alerts via the existing `MALL_WEBHOOK_URL`.
**Why here:** tests prove the code is correct at merge time; this proves the *live system*
stays correct as real orders flow — the safety net for the whole "one coherent system" claim.

**Copy-paste prompt**
```
Add a READ-ONLY production reconciliation monitor. It must never write to D1.

1. Implement scripts/verify-prod-reconciliation.ts (or a scheduled Worker) that runs these
   read-only queries against D1 idofera and reports a pass/fail table:
   - SUM(non-historical sales.total_kobo) vs SUM('Sale Inflow') - SUM('Sale Refund').
   - Per product: stock_qty vs opening + SUM(signed stock_movements.qty) (flag drift > 0).
   - Liquid balance per account vs SUM(signed money_movements by account).
   - Any non-historical expense with no matching 'Expense Outflow'.
   - Any mall order stuck in a non-terminal state beyond its SLA.
   - Freshness of the drain ('maintenance') and sweep ('sweep') markers.
2. Use a read-only API token; assert the DB id is the production idofera ONLY as a read
   target, and that every statement is SELECT.
3. On any failure, POST an alert to MALL_WEBHOOK_URL (signed with MALL_WEBHOOK_SECRET) and
   exit non-zero. Support a --dry-run that prints the table without alerting.
4. Schedule it every 15-60 minutes (Cloudflare cron on --env mall, or a GitHub Action cron).

Acceptance: runs read-only, prints the reconciliation table, and fires a test alert when a
threshold is deliberately broken in a dry run.
```

---

## Phase 8 — Mutation testing on the money modules (stretch)

**Type:** test-quality verification · **Framework:** `Stryker`
**Why:** 100% coverage does not prove the tests *catch* bugs. Mutation testing on the money
modules proves the suite actually bites, and exposes assertions that check status codes but
not the ledger.

**Copy-paste prompt**
```
Set up Stryker mutation testing scoped to the money modules only
(src/server/mallApi.ts, mallOrderAdminApi.ts, mallOperations.ts, relationalMapper.ts,
relationalWrites.ts, and the money functions of src/context/AppContext.tsx). Configure the
node:test runner, set a break threshold, and run it in CI weekly (not per-PR). Fix or
explicitly waive every surviving mutant in the money logic; report the mutation score.
Acceptance: mutation score meets the agreed break threshold on the money modules.
```

---

## Sequencing summary

1. **Phase 0** — harness + prod guard + coverage gate. *(1–2 days)*
2. **Phase 1** — money-path invariants. *(the big one; 3–5 days)*
3. **Phase 2** — vocabulary contract. *(half a day)*
4. **Phase 3** — property-based money math. *(1 day)*
5. **Phase 4** — full-flow integration + parity. *(2–3 days)*
6. **Phase 5** — real D1/workerd preview contract. *(2 days)*
7. **Phase 6** — frontend + browser E2E. *(2–3 days)*
8. **Phase 7** — prod read-only monitor. *(1 day)*
9. **Phase 8** — mutation testing. *(stretch)*

**Definition of done for "money paths at full coverage":** phases 0–4 green in the PR gate,
100% line+branch on the money modules, every `MoneyMovementType`/`MovementType`/
`LiquidAccountType` exercised, every flow ending in a reconciliation assertion, phase 5 green
against preview, and phase 7 alerting on the live system — with no test ever writing to the
production database.

