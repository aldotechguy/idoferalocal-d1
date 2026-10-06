# Production Readiness Audit — Idofera Unified Mall Ecosystem

**Auditor role:** Senior QA architect / systems auditor
**Target:** LIVE production — `https://idomall.olz.workers.dev` (Worker `idomall`, env `--env mall`)
**Backend canon:** Cloudflare D1 relational `idofera` (100% relational), R2 bucket `idomall`
**Repository:** `aldotechguy/idoferalocal-d1`, branch `feature/unified-mall` (HEAD `137a75e`)
**Date:** 2026-10-06

---

## 1. Executive summary

The ecosystem is architecturally coherent and *largely* behaves as one integrated
business system. A mall checkout, payment, dispatch and refund are each implemented as
atomic D1 batches that write across the storefront, inventory, sales, finance and
customer layers, and the mirrored records flow into the same relational tables the POS,
Business Management, Mall Operations and analytics layers read. Live readiness reports
`ready: true` with every gate green, and public catalog/search/config/health endpoints
behave correctly.

However, the audit found **real cross-layer inconsistencies** that mean the system is
**not fully production-ready as one coherent financial/analytics system**, even though
the customer-facing storefront works:

1. **[High] Mall refunds write a money-movement type `Refund Outflow`** that is outside
   the financial vocabulary (`Sale Refund`). Mall refunds do not appear in the treasury
   "Sale Refunds" filter, do not roll into the treasury inflow/outflow stats, and carry
   an invalid destination account. The liquid balance is *not* corrupted (the
   calculation is account-based), but financial *classification* and reporting are
   inconsistent with POS refunds.

2. **[Medium] Delivery-fee "Logistics" expenses are booked with no paired
   `Expense Outflow` money movement.** Both the POS "confirm pickup" flow and the Mall
   dispatch flow insert a Logistics expense row directly, whereas a normal expense goes
   through `addExpense`, which also records an `Expense Outflow` money movement. Net
   result: expense-based profit reports and the treasury liquid balance can diverge by
   the cumulative delivery fees.

3. **[Medium] Mall stock-out movements use a non-standard type `Mall Order`** instead of
   the POS vocabulary `Outgoing`. Stock *quantity* is correct (the `UPDATE products`
   runs in the same atomic batch), but movement history/filters/analytics keying off
   `Outgoing` will not classify mall fulfilment as sales outflow.

4. **[Medium] Readiness `scheduler` is only refreshed by the 10-minute *drain* cron, not
   the hourly *sweep* cron** that performs unpaid-order expiry and stock release. A dead
   sweep cron leaves readiness green while unpaid orders stop expiring and reserved
   stock is never released.

5. **[Low] Catalog list/search report `sold: 0`** (a documented performance trade-off),
   while product detail and the top-sellers rail report real sold quantities. This makes
   cross-layer "popularity" signals inconsistent and disables real popularity sorting on
   the catalog.

6. **[Low] Unknown `/api/*` paths return `401 Authentication required`** rather than
   `404`, because the private-API gate runs before routing.

A full, *writable* end-to-end propagation test (place order → pay → dispatch → refund,
then assert stock/sale/money/customer/analytics reconciliation) was **not performed
against live production**, because the live system carries a real business's bank
details, customers, stock and financial records. That verification belongs in the
isolated `--env preview` deployment (`npm run verify:mall-contract`), which the
repository already provides and which last passed on 2026-09-25.

---

## 2. Scope & methodology

### 2.1 What was tested live (read-only / non-destructive)

- `GET /api/health`, `GET /api/mall/health`, `GET /api/mall/ready`
- `GET /api/mall/config`, `GET /api/mall/products` (list, search, sort, inStock), `GET /api/mall/products/:id`
- `GET /api/mall/orders` (phone-scoped order lookup, validation errors)
- `GET /api/mall/cart/total`, `GET /api/mall/checkout` (missing-session / method errors)
- Anonymous access to every staff/private endpoint (gate behaviour)
- HTTP response headers (cache, CORS) on public routes

### 2.2 What was NOT done (deliberately, and why)

- **No checkout, no payment, no dispatch, no refund was executed against live
  production.** These decrement real stock, mint real `sales`/`money_movements`/`customers`
  rows, and fire real customer/operator notifications for a real business (live bank
  account `MONIEPOINT / IDOFERA ENTERPRISE / 8063766861` is served at
  `/api/mall/config`). Placing test orders in that environment would corrupt its
  financial records.
- No Cloudflare credentials are available in this sandbox, so the D1 relational store
  could not be queried directly (`npx wrangler whoami` → unauthenticated). Data-integrity
  assertions below are therefore derived from source review plus the live HTTP surface,
  not from direct SQL.

### 2.3 How cross-layer propagation was assessed

For every business event (checkout, payment, dispatch, refund, cancel, expiry) the
code paths were traced end-to-end across the shared relational schema and the shared
front-end snapshot contract, and cross-checked against the vocabulary the POS /
treasury / reports layers actually consume. The shared modules
(`relationalDdl.ts`, `relationalMapper.ts`, `relationalSnapshot.ts`,
`relationalWrites*.ts`, `mallApi.ts`, `mallOrderAdminApi.ts`, `mallOperations.ts`) are
imported by *both* the Cloudflare Worker (`sites-worker.ts`) and the Node twin
(`server.ts`), so there is a single source of truth for the mapping logic.



---

## 3. System architecture (the layers under test)

| Layer | Surface | Backing |
|---|---|---|
| Customer-facing mall | `/` storefront, `/api/mall/*` (catalog, cart, checkout, track) | `mall_orders`, `mall_cart*`, `products`, `payments` |
| POS | staff `/labs` → `/api/storage/snapshot` + `/api/storage/records` | same relational tables |
| Business Management | inventory, sales, purchases, customers, suppliers | `products`, `sales`, `sale_items`, `purchases`, … |
| Mall Operations | `/api/staff/mall-orders`, `/api/staff/mall-listings`, `/api/staff/product-images` | `mall_*`, `products` |
| Finance / treasury | money movements | `money_movements` |
| Analytics / BI | dashboard, reports | `sales`, `expenses`, `money_movements`, `stock_movements` (via snapshot) |
| Backend | D1 `idofera` (relational), R2 `idomall`, cron (`drain` 10-min, `sweep` hourly) | — |

Key design fact: **there is one relational database and one snapshot contract.** The
staff workspace and the mall do not maintain separate stores; a mall sale is a row in
the same `sales` table the POS reads. This is the correct shape for an integrated
system and is the reason most propagation is correct.

### Cross-layer data flow (verified in code)

```
Mall checkout (public, atomic batch)
  ├─ products.stock_qty  − qty                  → POS inventory
  ├─ stock_movements      type='Mall Order'     → movement history  ⚠ non-standard type
  ├─ mall_orders          status='pending'
  ├─ mall_order_items
  ├─ payments             status='pending'
  ├─ mall_cart_items      cleared
  └─ sync revision bumped

Mall payment (staff finalizePayment, atomic)
  ├─ sales + sale_items   status='Completed', is_historical=0  → POS sales, reports, dashboard
  ├─ payments             status='paid', sale_id set
  ├─ money_movements      type='Sale Inflow'    → treasury
  ├─ customers            created / counters bumped (purchase_history, lifetime_value, loyalty)
  ├─ mall_orders          linked_sale_id, status='processing'
  └─ sync revision bumped

Mall dispatch (transitionOrder mark-out-for-delivery)
  ├─ delivery_orders      created (is_pickup_confirmed=1)
  ├─ expenses             Logistics (delivery fee)              ⚠ no Expense Outflow MM
  └─ delivery_orders      status='Out for Delivery'

Mall refund (refundOrder, atomic)
  ├─ sales                status='Refunded', total_refunded, updated_at
  ├─ sale_items           returned_qty = qty
  ├─ money_movements      type='Refund Outflow'                 ⚠ wrong type / dest acct
  ├─ customers            counters clawed back
  ├─ products.stock_qty   + qty  (only when returnStock=true)
  ├─ stock_movements      type='Returned'
  └─ sync revision bumped

Mall cancel / unpaid-expiry (cancelOrder, atomic)
  ├─ mall_orders          status='cancelled'
  ├─ products.stock_qty   + qty
  ├─ stock_movements      type='Returned'
  └─ payments             status='cancelled'
```

---

## 4. Live test results (read-only)

| Check | Result | Notes |
|---|---|---|
| `/api/health` | `200 {"status":"ok"}` | liveness |
| `/api/mall/health` | `200 {ok:true, routes:[…]}` | |
| `/api/mall/ready` | `200 {ready:true}` | all 13 checks true |
| `/api/mall/config` | `200` | real bank + pickup config served |
| `/api/mall/products` | `200`, 24 products | all `available:true`, `stock>0`, `sold:0` |
| `/api/mall/products/:id` | `200` | e.g. "Ring Pet (40cl)" `sold:189, stock:28` |
| `/api/mall/products?q=pouch` | `200` | search works |
| `?sort=popular` | `200` | **merchandised order, not popularity** (sold:0) |
| `?sort=price_asc` | `200` | correct ordering |
| `/api/mall/orders` (invalid) | `400` structured `fields` | validation correct |
| `/api/mall/orders` (valid shape, unknown) | `200 {orders:[],total:0}` | |
| `/api/mall/cart/total` (no session) | `400` | session enforced |
| `/api/mall/checkout` (GET) | `405` | method enforced |
| `/api/mall/bogus` | `404` | |
| `/api/nope` | `401 Authentication required` | ⚠ should be 404 |
| staff/private endpoints (anon) | `302 → /` | gate enforced |
| 12× rapid `GET /api/mall/products` | all `200` | read route not rate-limited |
| CORS preflight (cross-origin) | `405`, no ACAO | same-origin only (intended) |

**Observation (cross-layer):** list/search `sold` is `0` for all 24 products, while
detail reports real values (e.g. 189). This is the documented `catalogColumns` vs
`catalogSoldColumns` split (`mallApi.ts` lines 96–122), but it is visible to a customer

---

## 5. Findings

### F1 [High] — Mall refund money movement uses `Refund Outflow`, outside the financial vocabulary

**Evidence**
- `src/server/mallOrderAdminApi.ts:475` inserts a `money_movements` row with
  `type = 'Refund Outflow'`, `subtype = payment_provider`, `source_account = paymentDestination(provider)`,
  and `dest_account = payment_provider` (i.e. `'Cash'`/`'Card'`/`'Mobile Transfer'`/`'Bank Transfer'`).
- The canonical refund type is `'Sale Refund'` — declared in `src/types/index.ts:462`
  (`MoneyMovementType`) and written by the POS refund path (`AppContext.tsx:2297`).
- `'Refund Outflow'` is **not** a member of `MoneyMovementType`.

**Impact**
- `MoneyMovementView.tsx` (lines 116–127) computes `totalInflow`/`totalOutflow` by type:
  `'Refund Outflow'` matches neither the inflow nor the outflow branch → mall refunds are
  **excluded from the treasury outflow statistics**.
- The "Sale Refunds" filter option and `getTypeBadge` have no case for `'Refund Outflow'`
  → it renders with the grey fallback badge and cannot be selected.
- `dest_account = 'Cash'` etc. is not a `LiquidAccountType`; the client
  `sanitizeMoneyMovements` (`AppContext.tsx:113–115`) coerces it to `undefined`, so the
  movement shows a bogus "to" account.
- The liquid balance is **not** corrupted: the balance calculator
  (`AppContext.tsx:547–584`) is account-based and `source_account` is correct
  (`Physical Cash`/`Biz Account`), so cash/bank totals still move in the right direction.

**Recommendation:** write mall refunds with `type='Sale Refund'` (subtype
`"<method> Refund (Full)"` for parity with POS), `sourceAccount` = liquid account, and
no `dest_account` (or a valid account), matching `AppContext.tsx:2294–2306`.

### F2 [Medium] — Delivery-fee Logistics expenses have no paired `Expense Outflow` money movement

**Evidence**
- POS `addExpense` (`AppContext.tsx:4179–4198`) always records an `Expense Outflow`
  money movement for a non-zero expense.
- But POS `confirmDeliveryPickup` (`AppContext.tsx:4919–4935`) and Mall dispatch
  (`mallOrderAdminApi.ts:397–409`) both `INSERT` a Logistics expense **directly**, never
  emitting the corresponding `Expense Outflow` money movement.

**Impact**
- The delivery fee is collected into the business via the `Sale Inflow` money movement
  (which uses `total_kobo`, i.e. subtotal **+ delivery fee**), but the courier cost is
  booked only as an expense row — the cash does not leave the treasury ledger.
- Expense-based profit in **Reports** (`ReportsView` sums `expenses`) and the
  **treasury liquid balance** (`money_movements`) therefore diverge by the cumulative
  delivery fees across all dispatched orders.
- This is a systemic gap (POS and Mall agree with each other), but it violates the
  financial invariant that a non-historical cash expense produces a matching outflow.

**Recommendation:** decide the intended settlement model and implement it uniformly:
  (a) emit an `Expense Outflow` money movement when the courier cost is a real cash
  outflow, or (b) if the delivery fee is a pure pass-through that never leaves the
  tracked accounts, stop booking it as a cash `Expense` (use a non-cash category) so
  Reports and treasury stay consistent.

### F3 [Medium] — Mall stock-out movement uses non-standard type `Mall Order`

**Evidence**
- Checkout writes `stock_movements.type='Mall Order'` (negative qty) at
  `mallApi.ts:754–761`.
- The POS vocabulary (`src/types/index.ts:72–80`) is `Opening Stock | Incoming |
  Outgoing | Adjustment | Damaged | Returned | Lost | Transfer`. `Mall Order` is absent.
- Cancel/refund use `Returned` (in-vocabulary) — only the outflow side is non-standard.

**Impact**
- Any movement history / filter / report keyed off `Outgoing` to represent "sales
  outflow" will not classify mall fulfilment. `stock_qty` itself is correct because the
  decrement `UPDATE` runs in the same atomic batch, so inventory counts are unaffected.

**Recommendation:** use `Outgoing` for the mall checkout stock movement (or explicitly
  add `Mall Order` to `MovementType` and handle it everywhere the POS handles `Outgoing`).


### F4 [Medium] — Readiness `scheduler` is driven only by the drain cron, not the stock-release sweep

**Evidence**
- `wrangler.toml [env.mall.triggers] crons = ["*/10 * * * *", "7 * * * *"]`; the handler
  maps `"7 * * * *"` → `sweep` and everything else → `drain` (`sites-worker.ts:1107–1109`).
- `runMallMaintenance` (`mallOperations.ts:509`) sets `ownsMarker = mode !== 'sweep'`;
  the readiness marker (`mall_job_runs`) is written only when `ownsMarker`
  (`mallOperations.ts:572–574`).
- Unpaid expiry + stock release run only under `sweep` (`mallOperations.ts:512–529`).

**Impact**
- A dead/missing hourly sweep (which expires unpaid orders and releases reserved stock
  via `cancelOrder`) is invisible to `/api/mall/ready`: `scheduler` stays `true` as long
  as the 10-minute drain fires. Inventory can drift (stock reserved by abandoned orders)
  while readiness reports green.

**Recommendation:** surface a distinct readiness signal for the sweep (e.g. a separate
  `sweep` marker or a "last successful expiry" watermark) and alert on it independently.

### F5 [Low] — Catalog list/search report `sold: 0` and popularity sort is inert

**Evidence**
- `catalogColumns` omits the sold-quantity subquery; only `catalogSoldColumns` (detail +
  top-sellers rail) computes it (`mallApi.ts:96–122`).
- `CATALOG_SORTS.popular` references `sold_qty`, but the catalog path falls back to
  `POPULAR_FALLBACK_SORT` (merchandised order) — confirmed live: `?sort=popular` returns
  default order with `sold:0`.

**Impact**
- "Popular"/"best sellers" is not actually popularity-based on the catalog, and any
  card-level "sold" display would show `0` while the detail page shows the real figure.
  Cross-layer analytics vs. storefront is intentionally inconsistent.

**Recommendation:** either label the fallback honestly in the UI or restore the indexed
  sold-quantity aggregation for catalog rows (the covering index already exists,
  `idx_sale_items_product`).

### F6 [Low] — Unknown `/api/*` returns 401 instead of 404

**Evidence**
- `isPrivateApi` (`staffEntrance.ts:20–28`) treats every `/api/` path not explicitly
  public as private, so the gate (`sites-worker.ts:1146`) 401s *before* the router can
  answer 404. Live: `GET /api/nope` → `401 Authentication required`.

**Impact:** minor information leak (confirms a private namespace) and confusing
  semantics for clients probing unknown endpoints. Cosmetic, not exploitable.

---

## 6. Risks & operational notes

1. **Stock is reserved at checkout, not at payment.** An order decrements stock in
   `pending` state and only the hourly sweep (default 48 h, `MALL_UNPAID_EXPIRY_HOURS`)
   or an explicit cancel releases it. This is a reasonable reserve-on-order model, but
   it couples inventory accuracy to the sweep cron (see F4).
2. **Expiry cancels `confirmed` orders too.** `runMallMaintenance` expires
   `status IN ('pending','confirmed')` with no linked sale after 48 h
   (`mallOperations.ts:515`). A confirmed order awaiting a slow bank transfer could be
   auto-cancelled and its stock released while the customer still expects fulfilment.
   Review this window against payment realities.
3. **Deployment state vs. docs.** `docs/mall-launch-safety.md` records that `usr-admin-1`
   still carries `is_super_admin=1` in `idofera` while the client displays it as
   non-super-admin, and that the two `idofera` accounts still use legacy usernames — a
   known reconciliation that should be resolved before SSO reaches the super-admin flag.
4. **`app_users`/`app_sessions` are still live in the relational canon.** Ensure any
   published migration dumps no longer carry seeded credentials (the
   `mall-launch-safety.md` audit found historical dumps did).

---

## 7. What could not be verified live, and how to verify it

The following end-to-end write assertions require the **isolated preview environment**
(`--env preview`, D1 `idofera-preview`, R2 `idomall-preview`) and are already automated
by `npm run verify:mall-contract` (last green 2026-09-25):

- Checkout → `products.stock_qty` decremented AND a `stock_movements` row created in one
  batch (oversell trigger aborts on negative stock).
- Payment → mirrored `sales`+`sale_items` with `status='Completed'`, `is_historical=0`,
  one `Sale Inflow` money movement, customer counters/loyalty bumped.
- Dispatch → `delivery_orders` + Logistics expense, then `complete`.
- Refund (`returnStock` true/false) → stock restore, `Sale Refund` (or corrected)
  movement, customer clawback, sale marked `Refunded`.
- Reconciliation assertion: `SUM(money_movements where Sale Inflow) == SUM(sales where
  !is_historical)` and inventory = opening ± Σ(stock_movements) — the single most
  important cross-layer invariant to assert continuously.
- Cron/heartbeat/webhook delivery to a real receiver (signature verification, retry,
  dedupe, Gmail-deliverability pacing).

**Recommended acceptance gate:** run these against preview with the write-contract
script, then add a periodic (e.g. daily) reconciliation job in preview/staging that
asserts the sales↔money-movement↔stock invariants before any further production cutover
claims.

---

## 8. Bottom line

The system is a genuine single-schema integrated design and the read surface is healthy
and correctly gated. It is **not** yet production-ready as *one coherent financial and
analytics system* until F1 (refund movement vocabulary) and F2 (delivery-fee expense
outflow) are resolved, F4 (sweep readiness) is addressed, and the full write-path
reconciliation is re-verified in preview. The storefront itself is sound; the gaps are
in the back-office propagation that makes the "one system" claim true.

and makes the storefront's own popularity signals inconsistent with the analytics layer.
