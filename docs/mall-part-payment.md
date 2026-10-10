# Mall Order Part Payment → Customer Debt (Implementation Plan)

Status: **implemented (server-side).** The companion regression suite
`scripts/mall-part-payment.test.ts` (`npm run test:mall-part-payment`) encodes
the behaviour below and now passes. The staff settlement UI (a partial-amount
input) and the buyer-facing "balance due" display are still pending — see §4.

## 1. Goal

An existing customer may place an online (Mall) order and, at settlement time,
pay only **part** of the order total. The order is still released for
fulfilment (it is not held as unpaid), and the **unpaid balance is recorded
against the customer as a debt** so it shows up in the Customer's Hub and can
be settled later through the existing debt-settlement flow.

Today `finalizePayment` in `src/server/mallOrderAdminApi.ts` hard-requires the
payment to equal the whole order total:

```ts
if (!Number.isSafeInteger(body?.amountKobo) || amountKobo !== n(row.total_kobo))
  fail(400, 'The payment amount must equal the order total in whole kobo.');
```

and writes the mirrored `sale` as fully paid (`paid_kobo = total_kobo`), sets
the payment row to `paid`, and never touches the customer's
`outstanding_balance_kobo`. Part payment has to change all four of those.

## 2. Where the money already lives (do not reinvent)

| Concept | Table / field | Notes |
| --- | --- | --- |
| Mall order total | `mall_orders.total_kobo` | server-priced at checkout |
| Mirrored sale | `sales` (`paid_kobo`, `total_kobo`) | one row per settled order, id `sale-<orderId>` |
| Payment | `payments` (`amount_kobo`, `status`) | keyed by `order_id` |
| Customer debt | `customers.outstanding_balance_kobo` | the Hub's single source of truth |
| Treasury inflow | `money_movements` (`Sale Inflow`) | one row per settlement |
| Debt settlement math | `src/shared/customerLedger.ts` → `unpaidOf`, `settleCustomerBalance` | already clamps, already reconciles oldest-first |

The customer ledger module is deliberately pure and already models "unpaid part
of a sale = debt": `unpaidOf(sale) = max(0, total - paid)`. **Part payment must
make the mirrored sale's `paid_kobo` reflect only what was actually paid**, so
that the ledger derives the debt for free and the existing settle flow can pay
it off later. No new debt concept is introduced.

## 3. Contract (the shape the test asserts)

### 3.1 Request

`POST /api/staff/mall-orders/:id/collect-payment`

```jsonc
{
  "paymentMethod": "Cash" | "Card" | "Mobile Transfer" | "Bank Transfer",
  "amountKobo": 20000,          // the amount actually collected, in kobo
  "reference": "…",             // required for Bank Transfer (unchanged)
  "paymentBreakdown": { … }     // optional, unchanged
}
```

New rules (replacing the "must equal total" rule):

- `amountKobo` must be a safe integer ≥ 0.
- `amountKobo` must be **≤** the order total (`total_kobo`). Over-paying
  remains a hard `400` — the business never takes more than the price on a
  Mall order.
- `amountKobo` **may now be less than** `total_kobo` (part payment).
- `amountKobo === 0` — **decision needed** (see §6). Plan default: reject with
  `400` on this endpoint; a genuinely unpaid order stays `pending` and is not
  settled here (a "record as full debt" path, if wanted, is a separate action).
- A part payment below the order total is only allowed for an **identifiable
  existing customer** (see §3.3); otherwise it is refused.

### 3.2 Order / payment state after a part payment

Let `paid = amountKobo`, `due = total_kobo − paid`:

- `sales.paid_kobo = paid` (not `total_kobo`).
- `sales.status` stays `'Completed'` (the sale happened; only part is paid).
- `payments.amount_kobo = paid`, `payments.status = due > 0 ? 'partial' : 'paid'`.
- `money_movements` `Sale Inflow` amount = `paid` (only cash actually received).
- `mall_orders` moves to `'processing'` and gets `linked_sale_id` / `customer_id`
  exactly as today (the order is released for fulfilment regardless of the
  shortfall — this is what "part pay for an online order they made" means).
- Response exposes the remainder so the staff UI can show it. Add to the order
  payload (`publicOrder`): `paidKobo` and `amountDueKobo`.

### 3.3 Customer debt recording

- The buyer is matched to a customer by normalized phone (existing logic,
  `normalizeMallPhone` + `normalizedPhoneSql`).
- **If a customer matches** (existing customer): `customers.outstanding_balance_kobo
  += due`. The customer-counter update that already runs must add the debt:
  `outstanding_balance_kobo = outstanding_balance_kobo + ?` with `due`.
- **If no customer matches** (DECIDED): a part payment for an unrecognised phone
  is **refused** with `400`. Debt can only be booked against a known customer, so
  the operator must first register the customer (or take full payment). Full
  payment for an unknown phone is unchanged — it still mints the customer row, as
  today, since no debt is created.
- `purchase_history_count` still increments by 1 (an order was placed).
- **`lifetime_value_kobo` accrues on the amount actually PAID** (DECIDED):
  `lifetime_value_kobo += paid`, not `+= total_kobo`. Unpaid money is a
  receivable, not realised value. Loyalty points follow the same rule — they are
  credited on `paid` using the existing formula
  (`Math.floor(paid / 10_000)` on the server). Both the new-customer insert and
  the returning-customer update must use `paid`.

### 3.4 Idempotency & concurrency (unchanged, must be preserved)

- Replaying `collect-payment` on an order that already has `linked_sale_id`
  returns the current detail (200) and creates nothing new.
- `runOrderBatch` + `revisionBumpStatement` semantics are unchanged: a part
  payment is exactly as atomic and revision-bumping as a full one, so guarded
  snapshot clients re-read the mirrored sale and the updated customer balance.

### 3.5 Refund interaction (must not regress)

`refundOrder` currently decrements `lifetime_value_kobo` / `loyalty_points` by
the full total and claws back store credit. With part payment the refund must
**not** assume the sale was fully paid when computing the customer's debt
relief — the debt that part payment created has to be unwound on refund. The
existing `refundCustomerMetrics` in the shared ledger already models this via
`unpaidOnSale`; the server refund path must pass the real unpaid amount
(`total_kobo − paid_kobo`) rather than assuming zero. Because LTV/points now
accrue on `paid`, the refund unwind must decrement by `paid` too — otherwise it
would claw back value the customer never actually realised. The test includes a case
for it.

## 4. Files to change (when implementing)

1. **`src/server/mallOrderAdminApi.ts` — `finalizePayment`**
   - Relax the amount check to `0 ≤ amountKobo ≤ total_kobo`, reject `0` per §6.
   - Thread `paid`/`due` through the statement batch:
     - `sales.paid_kobo = paid`
     - `payments.amount_kobo = paid`, `status = due > 0 ? 'partial' : 'paid'`
     - `money_movements.amount_kobo = paid`
     - customer update: `outstanding_balance_kobo += due` (new-customer insert
       seeds `outstanding_balance_kobo = due` when `due > 0`).
   - Extend the payments enum: allow `'partial'` alongside `'paid'` in whatever
     validation reads `payments.status` (check `publicPayment` and any
     `paymentStatus` consumers such as the Mall order lookup in `mallApi.ts`,
     which computes `amountDueKobo = total − paid` — verify it reads
     `sales.paid_kobo`/`payments.amount_kobo`, not a constant).
2. **`src/server/mallOrderAdminApi.ts` — `publicOrder`**
   - Include `paidKobo` and `amountDueKobo` from the mirrored sale / order.
3. **`src/server/mallOrderAdminApi.ts` — `refundOrder`**
   - Pass real unpaid portion into the customer-metric unwind.
4. **`src/services/staffMallClient.ts`**
   - `StaffMallOrder` type: add `paidKobo`, `amountDueKobo` (optional).
   - `collectPayment` signature already accepts `amountKobo`; no shape change.
5. **`src/types/mall.ts`**
   - `MallOrder` already has `paidKobo` / `amountDueKobo`; verify the buyer-facing
     tracking page renders a partial remainder correctly (out of scope for the
     server test, note for the UI ticket).
6. **Staff Mall order UI** (the settlement modal that calls `collectPayment`)
   - Add a "amount received" input defaulting to the full total, showing the
     computed balance that will be booked as debt and the matched customer.
   - *Not covered by the server test; separate UI ticket.*
7. **`docs/mall-operations.md` / `docs/user-help.md`**
   - Document part payment and the debt it creates.

## 5. Test plan (`scripts/mall-part-payment.test.ts`)

Node `node:sqlite` in-memory fixture mirroring `mall-backend.test.ts`. Cases:

1. **Part payment is accepted** and the mirrored sale records only the paid
   portion (`sales.paid_kobo = paid`), order proceeds to `processing`.
2. **The unpaid balance becomes customer debt** (`outstanding_balance_kobo = due`).
3. **A returning customer's existing debt is increased, not replaced.**
4. **Payment row is `partial`; money movement equals cash received only.**
5. **Full payment still behaves exactly as today** (`paid_kobo = total`,
   status `paid`, zero debt) — no regression.
6. **Over-payment is rejected** (`400`, nothing written).
7. **Zero payment is rejected** on this endpoint (per §6 default).
8. **Part payment for an unknown phone is refused** (`400`, nothing written) —
   debt can only be booked against a recognised customer.
9. **Replay is idempotent**: no duplicate sale, no double debt.
10. **A refund of a part-paid order clears the debt it created** and does not
    leave phantom balance or over-refund the customer.

Every assertion is written against the **planned** contract, so all ten fail
against today's code (the first failures are the `400` on any amount below the
total, and the missing `outstanding_balance_kobo` write).

## 6. Resolved decisions

1. **Unknown-phone part payment → REFUSE.** A part payment is only accepted when
   the phone matches an existing customer; an unrecognised phone gets a `400`.
   Full payment for an unknown phone is unchanged (still creates the customer
   row, as today). The feature is scoped to *existing* customers.
2. **LTV / loyalty → on the amount actually PAID.** `lifetime_value_kobo` and
   `loyalty_points` accrue on `paid`, not on the full order total — unpaid money
   is a receivable, not realised value. (Consistent with the shared ledger's
   `unpaidOf` / `paidOf` split.)

## 7. Still open

1. **Zero-kobo settlement.** Reject (plan default) or allow as "100% debt"?
2. **Overpayment ceiling.** Confirm part payment can never exceed the total
   (no store credit from a Mall order) — consistent with the ledger's rule that
   over-settlement is clamped, never minted as credit.
3. **Debt visibility to the buyer.** Should the storefront tracking page show
   "balance due" to the buyer, or is the debt staff-side only?
