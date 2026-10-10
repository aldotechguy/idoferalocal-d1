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
The staff client no longer bundles super-administrator or administrator passwords —
they were dropped from `AuthContext` so no script can read them out of the bundle. That
still does not revoke credentials already stored server-side: before launch, rotate
previously seeded administrator passwords, invalidate their existing sessions, and
verify authorized administrators can still sign in.

BUG FIXED (2026-09-26) — the staff client still bundled a super-administrator
PROFILE, which is what actually produced an unexplained `401` on
`POST /api/auth/login`. `AuthContext` exported a hardcoded `SUPER_ADMIN_USER`
(`usr-superadmin-idofera` / `michaelidongesit5@gmail.com` / username `idofera`) and
seeded it into `INITIAL_USERS`; `sanitizeUsersList` re-added it any time a stored
list lacked it; and `isSuperUser()` promoted any profile whose id, username or
e-mail matched those literals while deliberately ignoring `is_super_admin`. The
previous note claimed super-user status "is now derived from server-set
identity/flags only instead of a display-name match" — that was true of the
display-name test, but the id/username/e-mail backdoor remained, so it was not yet
true overall.

Consequence: an empty browser (no server account, e.g. an unprovisioned database)
rendered a fully signed-in, fully unlocked Super-Admin workspace, while every
request to a private API answered 401 — the phantom user existed only in the
client. Because `sanitizeUsersList` re-injected it, clearing local storage did not
help. A second, latent defect: `sanitizeUsersList`'s `usr-admin-1` branch was dead
code (the force-super branch matched that id first), so the standard Administrator
was promoted to `isSuperAdmin: true` **and** `isProtected: true` on every load.

The client now carries no privileged account: `isSuperUser()` reduces to the
server-set `isSuperAdmin` flag, `sanitizeUsersList` cannot invent or promote a
user, and `INITIAL_USERS` holds a single password-less placeholder that grants
nothing. With no server-side account, the staff workspace now shows the sign-in
screen instead of a phantom session. Both runtimes' `DELETE /api/auth/users/:id`
also stopped hardcoding the legacy `usr-superadmin-idofera` id and honour the
stored `is_protected` flag instead — the old branch protected nothing the flag did
not, and only made a rotated-out account un-deletable.

The client change is necessary but NOT sufficient: a legacy database's `app_users`
rows still have to be reconciled. Changing the client cannot clear a stale
`idofera_users` localStorage entry on an existing device, so a user who already had
the phantom profile cached must sign out once, or clear site data, for it to drop.
`isProtected` on the placeholder is `false` deliberately: leaving it `true` would
error `'This Super-User account is protected and cannot be deleted.'` when a
super-admin deletes that unprovisioned placeholder.

The second defect was the staff-entrance gate itself, and it is the reason a real
`POST /api/auth/login` returned 401 even with a correct password. The gate
expression was inverted in BOTH runtimes:

```ts
// WRONG — applied the entrance to private APIs and skipped it for login
const entrance = !isPrivateApi(path) && await hasEntrance(cookie, query);
// RIGHT — the entrance gates staff pages and private APIs, never sign-in
const entrance = login ? true : await hasEntrance(cookie, query);
```

Because the entrance cookie is only ISSUED after a successful sign-in, requiring
it in order to sign in is circular. Every signed-out attempt was answered
`401 STAFF_ENTRANCE_REQUIRED` ("hold the Cart button for 3 seconds") before the
credentials were ever compared, so the message blamed the entrance and hid the
real cause. Fixed in `server.ts` and `sites-worker.ts`; private APIs still require
an app session and `/app` still 302s to `/` without one.

## Local credential rotation (executed 2026-09-26)

Both seeded local accounts were rotated and their sessions invalidated. A backup
of the database was taken first. New passwords were written to 0600 files under
the git-ignored `data/` directory and never printed; they are NOT recorded here.

- `usr-superadmin-idofera` — password rotated, `password_last_changed` bumped.
- `usr-admin-1` — password rotated; `is_super_admin` set back to 0 (see below).

`usr-admin-1` had `is_super_admin = 1` although it was seeded as a plain
Administrator. The client-side `sanitizeUsersList` bug promoted it in the browser,
so the stored flag no longer represented an intentional decision and was reset to
0. `scripts/set-super-admin.ts` makes that an explicit, audited operation: it
refuses to leave a database with zero super-admins, revokes the affected account's
sessions in the same transaction, logs to `data/admin-flag-changes.log`, and is
dry-run by default. It must be applied to the deployed databases too, which still
have `usr-admin-1` promoted.

Reusable tooling (`npx tsx ...`):

- `scripts/audit-local-auth.ts` — READ-ONLY report of users, flags and live sessions.
- `scripts/provision-admin.ts` — rotation/provisioning. Dry-run by default;
  `--apply` writes. Also `--list` and `--revoke-sessions <userId|all>`.
- `scripts/set-super-admin.ts` — audited super-admin flag changes.
- `scripts/purge-seeded-credentials.ts` — strips seeded auth rows from the SQL dumps.
- `scripts/verify-local-login.ts` — proves a credential works against the real
  login handler, with a wrong-password negative control.
- `scripts/verify-local-gate.ts` — proves sign-in is reachable from a cold browser
  while private APIs and staff pages still refuse an unauthenticated caller.

## Deployed database remediation (executed 2026-09-26)

An earlier revision of this section claimed the committed SQL dumps contained
"live session tokens" that were valid against the deployed database. **That was
wrong, and the correction matters:**

- The dumps DID contain the two seeded `app_users` rows (known password hashes)
  and 15 `app_sessions` rows; three of those 15 had not yet expired.
- **None of the 15 token hashes matched a row in any deployed database.** A
  `token_hash IN (...)` count returned 0 for all 15 on `idofera`. There was no
  exploitable session, because SQLite's `INSERT OR REPLACE` had overwritten those
  `token_hash` primary keys with newer sessions. Restoring the dump into an EMPTY
  database WOULD recreate all 15, with three immediately usable.
- The deployed password hashes were NOT the published ones either; both accounts
  already had rotated values. The dumps' remaining exposure was the KDF
  parameters and salts.

All 34 rows were nevertheless removed from the dumps by
`scripts/purge-seeded-credentials.ts`, which keeps the DDL so they still recreate
an empty, correctly-shaped auth schema.

Applied to `idofera` (the live `--env mall` target) only. `idofera-d1` and
`idofera-preview` were explicitly left alone by request.

A full SQL export was taken first:
`backups/idofera-pre-rotation-<timestamp>.sql` (1.8 MB, git-ignored via
`/backups/`). It contains both accounts and both sessions, so the rotation is
reversible if a credential is lost.

Then, against the live database:

- `usr-admin-1` — password rotated; 2 unexpired sessions revoked.
- `usr-superadmin-idofera` — password rotated; 1 unexpired session revoked.
- New passwords were written to 0600 files under the git-ignored `data/`
  directory and never printed: `data/idofera-admin-password.txt` and
  `data/idofera-idofera-password.txt`.
- Verified after writing: both `password_hash` values changed,
  `password_last_changed` bumped to 2026-09-26, and `app_sessions` is now empty
  (0 rows total, 0 live).

Resulting state, read back from D1:

| id | email | username | is_super_admin | is_protected |
|---|---|---|---|---|
| `usr-superadmin-idofera` | michaelidongesit5@gmail.com | `idofera` | 1 | 1 |
| `usr-admin-1` | admin@idoferapackaging.com | `admin` | 0 | 0 |

`usr-admin-1` was ALREADY `is_super_admin = 0` in the deployed database — the
promotion was a local-only side effect of the `sanitizeUsersList` bug, so no flag
change was needed here. The deployed database now has exactly one super-admin.

The old usernames (`idofera`, `admin`) were deliberately NOT changed: both are
`[A-Za-z0-9_-]{3,64}`, and renaming the super-admin would invalidate the
`Administrator` display name it shares with `usr-admin-1`. Renaming is a product
/ identity decision, not a security fix.

## Deployed Worker: staff-entrance fix is LIVE (2026-09-26)

The bug described below has been fixed and deployed. Recorded here because the
diagnosis is what matters if it ever regresses.

The deployed Worker was running `b35b782f` (2026-09-25T08:32Z), which predated the
gate fix, so its login handler rejected every sign-in with
`401 STAFF_ENTRANCE_REQUIRED` ("hold the Cart button for 3 seconds"). The cause was
the inverted gate expression (`!isPrivateApi(path) && hasEntrance(...)`) applied to
BOTH runtimes: it ran the staff-entrance check on the sign-in endpoints and skipped
it on the private APIs, exactly backwards. Because the entrance cookie is only
ISSUED after a successful sign-in, this made sign-in unreachable — and the error
message blamed the entrance rather than the real cause.

Remediated:

1. Fixed in `server.ts` and `sites-worker.ts`:
   `const entrance = login ? true : await hasEntrance(cookie, query)`.
2. `npm run build` (vite + esbuild server bundle).
3. `npx wrangler deploy --env mall` -> version `9aa2f1d0-23d2-4e90-8b98-03e7d558822b`.

Verified after deploy, against `https://idomall.olz.workers.dev`:

| Check | Result |
|---|---|
| `POST /api/auth/login` (`admin`) | 200, session cookie issued |
| `POST /api/auth/login` (`idofera`) | 200, `isSuperAdmin: true` |
| Wrong password (negative control) | 401 "Invalid credentials" — NOT an entrance error |
| `GET /api/auth/users` with session | 200 |
| `GET /api/auth/users` without session | 401 |
| `GET /app` without session | 302 -> `/` |
| `POST /api/mall-webhook` unsigned | 401 (HMAC still enforced) |
| `GET /` and `/api/mall/health` | 200 |

The negative control answering a CREDENTIALS error instead of
`STAFF_ENTRANCE_REQUIRED` is the proof the gate no longer intercepts sign-in.

Both rotated credentials were then verified through the deployed HTTP handler, not
merely against D1. The verification sessions they created were deleted afterwards;
`app_sessions` is back to 0 rows. Current deployed state: 2 users, 1 super-admin,
0 sessions.

## Original blocker report (retained for the diagnosis)

The rotation above is applied and verified in the database, but it could not be
exercised through the live login endpoint while the old version was deployed:

```
POST /api/auth/login -> 401
{"error":"Staff entrance expired. Return to the Mall and hold the Cart button for 3 seconds to reopen Staff Login.","code":"STAFF_ENTRANCE_REQUIRED"}
```

Until the redeploy, nobody could sign in to the live staff workspace at all,
including the newly rotated accounts, so the rotation was verified against D1
directly rather than through the deployed handler.

## Verification boundary

- `npm run lint`, `npm run test:mall-backend` (92), `npm run test:frontend` (45)
  all pass locally.
- The live database was read and written through `npx wrangler d1 execute
  --remote`; every write was re-read and confirmed.
- Both rotated credentials were verified end-to-end through the DEPLOYED login
  handler after the redeploy, including a wrong-password negative control and a
  usable session against a private API.
- Not verified: checkout, payment settlement, courier handoff, cron/heartbeat
  operation and notification delivery. The redeploy changed the auth gate and
  shipped the previously committed client/auth changes; it did not itself
  exercise any Mall order path.
- The redeploy also shipped the client changes described above (the phantom
  super-admin removal), so `--env mall` now matches this document.

- `drizzle/full_migration.sql` and `drizzle/migration_dump.sql` DID contain the two
  seeded `app_users` rows (known password hashes) and 15 `app_sessions` rows.
- Of those 15, **three had not yet expired** at the time of the audit. The other
  twelve had `expires_at` in the past. All 15 rows were nevertheless removed from
  the dumps, since a published token is compromised whether or not it is still live.
- **None of the 15 token hashes matched a row in any deployed database.** A
  `token_hash IN (...)` count returned 0 for all 15 on `idofera`, and the two live
  `idofera` sessions hashes are different rows entirely. There was no exploitable
  session, because SQLite's `INSERT OR REPLACE` had overwritten those `token_hash`
  primary keys with newer sessions. Anyone restoring the dump into an EMPTY database
  WOULD recreate all 15; the three unexpired ones would be immediately usable.

Also, contrary to the earlier note, the deployed password hashes are NOT the
published ones: both `idofera` accounts have rotated `password_hash` values. The
remaining exposure in the dumps was the KDF parameters and salts, which enable
offline cracking only if the plaintext was already guessable.

Live audit of every environment:

| Database | Environment | Users | Super-admins | Live sessions |
|---|---|---|---|---|
| `idofera` | `--env mall` (live) | 2 | 1 | 2 |
| `idofera-d1` | default (old preview target) | 2 | 1 | 0 |
| `idofera-preview` | `--env preview` | 0 | 0 | 0 |

Remaining deployed work: the two `idofera` accounts still use the old usernames
(`idofera`, `admin`) and `usr-admin-1` is still `is_super_admin = 1`; both should
be reconciled with `scripts/set-super-admin.ts` and a rotation, and the old preview
database `idofera-d1` should be deleted or emptied since it still holds accounts.

## Validation and limitations

Run `npm run lint`, `npm run test:mall-backend`, and `npm run test:frontend`.
The backend suite covers Node/SQLite and the actual Worker fetch handler through a
SQLite-backed D1-shaped binding with atomic batches. It tests races, duplicate
settlement, oversell, rollback, permissions, status mapping, static routing and
bootstrap behavior. This is not a deployed D1/workerd test and does not establish
Cloudflare platform limits, network behavior, or production configuration.

Before launch, repeat the contract checks in a disposable deployed preview database,
including the maximum intended cart size and existing-schema rollout. This is now
automated by `npm run verify:mall-contract` against the `--env preview` deployment —
see `mall-operations.md` for configuration, safety guards and the last run result.
Priorities 8–9
(notifications, rate limiting, readiness, bank instructions, catalog administration) are
now implemented — see `mall-operations.md` for their current behaviour and remaining
deployment gates. Tracking privacy stays deliberately minimal (exact order number plus
normalized phone; phone-only lookup rejected) and is not customer authentication.
Partial refunds/returns and reverse-logistics integrations remain unimplemented.