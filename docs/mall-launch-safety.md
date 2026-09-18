# Mall launch safety changes — September 18, 2026

Follow-up operational changes and current activation requirements are documented in
`mall-operations.md`. That document supersedes the outstanding-work notes below for
tracking, rate limiting, notifications, readiness, fulfilment, and phone matching.

## Scope

Priorities 1–7: atomic lifecycle preconditions, attempt-scoped checkout replay,
runtime error handling, validation, explicit refund disposition, removal of default
administrator credentials, and regression tests. No deployment or production build
is part of this change.

## Database rollout

`src/server/mallSafety.ts` owns two additive runtime schema statements:

- `mall_write_guards`: a transient CHECK-constraint assertion table. A failed
  precondition aborts the entire batch. Successful assertions delete their rows
  within the same transaction.
- `mall_checkout_attempts`: unique attempt key, session ownership, normalized
  request snapshot, unique order ID and creation timestamp.

Node bootstrap and Worker schema initialization both install these statements.
Existing orders and sales are preserved. No destructive migration is required.
Do not split a checkout or lifecycle write batch into separately committed chunks.
Do not delete attempt records while clients may still retry their associated orders.
The normalized request snapshot contains customer information; include this table
in database access controls and future retention/privacy policy work.

## API changes

Checkout requires `Idempotency-Key` (16–128 ASCII letters, digits, underscores or
hyphens) plus a valid session. A UUID is recommended. Retry the same attempt with
the same body and session; a conflicting body/session returns 409. An intentional
new purchase requires a new key. The storefront persists the pending attempt in
local storage until a successful response, including across network errors/reloads.
Old storefront clients without the header receive 400 and must refresh.

Checkout returns current payment information on replay. Public delivery fee and
paid amount inputs remain ignored. Missing/invalid customer or payment fields no
longer silently receive defaults. Structured field errors are returned for customer
and payment validation.

Current defensive limits: 1,000 units per line, 100 lines, total at most
1,000,000,000 kobo (10,000,000 naira), name 120 characters, phone 32, address/note
400. Review these limits against business needs before launch. Nigerian mobile
numbers are normalized to +234; other international numbers require +country-code.
Normalized/indexed tracking and full location verification remain separate work.

Refund requests require a boolean `returnStock` and a nonempty reason. Staff must
explicitly choose whether goods are physically returned/resellable (or were never
dispatched). A refund without returned stock does not create an inventory return.
Full return logistics and synchronization of existing delivery records remain out
of scope.

## Administrator provisioning

No known-default account is created. Existing users/passwords are never changed by
bootstrap. For an empty database only, set all three server-side secrets:

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_PASSWORD` — unique generated secret, at least 20 characters

Use local environment configuration for Node and Worker secret bindings for edge.
Do not commit credentials. After initial provisioning, remove the bootstrap
secrets. A database already containing users is never automatically reseeded.

IMPORTANT: removal of default provisioning does not revoke existing credentials.
Before launch, rotate previously seeded administrator passwords, invalidate their
existing sessions, and verify authorized administrators can still sign in.

## Validation and limitations

Run `npm run lint`, `npm run test:mall-backend`, and `npm run test:frontend`.
The backend suite covers Node/SQLite and the actual Worker fetch handler through a
SQLite-backed D1-shaped binding with atomic batches. It tests races, duplicate
settlement, oversell, rollback, permissions, status mapping, static routing and
bootstrap behavior. This is not a deployed D1/workerd test and does not establish
Cloudflare platform limits, network behavior, or production configuration.

Before launch, repeat the contract checks in a disposable deployed preview database,
including the maximum intended cart size and existing-schema rollout. Priorities
8–9 (notifications, tracking privacy, rate limiting, readiness, bank instructions,
catalog administration) remain outstanding.