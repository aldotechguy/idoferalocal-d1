# Regression Ledger

## The rule (enforced, not advisory)

**A bug is not "fixed" until a test that fails before the fix and passes after
the fix is merged — and that test is never deleted or weakened.**

* Every row in this ledger must be locked by a test in `scripts/regression/`
  whose name carries the `@regression:<ID>` tag.
* `scripts/regression/tag-coverage.test.ts` (runs as part of
  `npm run test:regression`, and therefore of `npm run test:ci`) fails the PR
  gate if a ledger row has no tagged test, or if a tagged test has no ledger
  row.
* Locking tests may only be made STRICTER. Removing an assertion, widening a
  tolerance, or deleting a test file in `scripts/regression/` is a regression
  in its own right and will fail review.
* All regression tests run in-memory (`DatabaseSync(':memory:')` via
  `scripts/test-harness.ts`). `MALL_CONTRACT_ALLOW_LIVE` must stay unset —
  nothing in this folder may ever touch a remote database, and
  `assertNotProduction()` guards every fixture.

### How to add a row

1. Fix the bug, then write (or port) a test into `scripts/regression/` named
   `@regression:<ID> — <one-line bug statement>` using the shared harness.
2. Verify it **fails against the pre-fix code** (`git stash` the fix or check
   out the parent commit — if it doesn't fail, it doesn't lock the bug).
3. Add a row below: `| <ID> | <one-line incident> | scripts/regression/<file>.ts
   (test name fragment) | <fix commit short hash> | Fixed |`.
4. Open the PR with `npm run test:regression` green. The tag-coverage test
   cross-checks the ledger against the tagged tests automatically.

| Incident | Repro test | Fix commit | Status |
| --- | --- | --- | --- |
| F1 — mall refund wrote type 'Refund Outflow' with a NULL account instead of 'Sale Refund' with its settlement account, breaking the Reports refund column and the liquid-ledger sign convention | scripts/regression/mall-money-writes.test.ts (`@regression:F1`) | `1d14377` | Fixed |
| F2 — the Logistics expense booked at dispatch shipped with no 'Expense Outflow' movement, so Treasury under-counted the courier cost that Reports (expense-based) did count | scripts/regression/mall-money-writes.test.ts (`@regression:F2`) | `fa9ae7e` | Fixed |
| F3 — mall checkout wrote stock type 'Mall Order' instead of 'Outgoing', which the invariant ledger signed as a POSITIVE delta and doubled phantom stock on every checkout | scripts/regression/mall-money-writes.test.ts (`@regression:F3`) | `fa9ae7e` | Fixed |
| F4 — readiness 'scheduler' stayed green off the hourly sweep's marker even when the drain cron stopped firing; the sweep must never refresh the drain marker | scripts/regression/mall-ops-routing.test.ts (`@regression:F4`, `@regression:F4b`) | `fa9ae7e` | Fixed |
| F5 — catalog browse paid the sold_qty join on every request and reported sold:0 (inert popular sort); browse must report sold:0 cheaply and only `sort=popular` pays the join and ranks by real sales | scripts/regression/mall-ops-routing.test.ts (`@regression:F5`) | `fa9ae7e` | Fixed |
| F6 — an unknown /api/* path returned 401 instead of 404, leaking that a private API namespace exists behind the path | scripts/regression/mall-ops-routing.test.ts (`@regression:F6`) | `fa9ae7e` | Fixed |
| N1 — the sync revision watermark was not monotonic when two mall writes shared a millisecond, making guarded-snapshot clients skip or re-fetch revisions | scripts/regression/sync-protocol.test.ts (`@regression:N1`) | `fa9ae7e` | Fixed |
| N2 — sync-from-pos trusted an inconsistent client total instead of deriving it from the line items, letting a tampered amendment rewrite the order value while the lines (and the buyer's email) said otherwise | scripts/regression/sync-protocol.test.ts (`@regression:N2`) | `bc088af` | Fixed |
