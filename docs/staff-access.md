# Staff access — Cloudflare Access in front of the staff surfaces

This document is the runbook for the zero-trust gate that sits in front of the
staff workspace. It is written to be executed by hand in the Cloudflare
dashboard; the only machinery in this repository is the JWT verification
(`src/server/accessJwt.ts`), the step-up confirmation (`src/server/stepUp.ts`)
and the drift guard that keeps this document, the code and the dashboard in
agreement (`src/server/staffAccess.ts`, `scripts/staff-access.test.ts`).

> **Scope:** no step here reads or writes `idofera-d1`. That database belongs to
> the default environment and is in active use elsewhere. Access/SSO work
> applies to `idofera` (`--env mall`) and `idofera-preview` (`--env preview`)
> only, and only additively.

## What the gate does and does not do

```
shopper ─▶ `/`, `/category/*`, `/search`, `/checkout`, `/orders`,
           `/api/mall*`, `/api/mall-webhook`, `/mall-images/*`,
           `/api/health`, `/api/auth/entrance` ─────────────▶ Worker (unchanged)
                                                            no Access involved

staff ──▶ Access application (IdP login, MFA, audit)
              │  verified `Cf-Access-Jwt-Assertion`
              ▼
           Worker ─▶ staff entrance cookie ─▶ app session (`app_users`)
                                            └─ super-admin = DB flag
                                               AND IdP group AND step-up
```

* Access authenticates a **person**; it never grants a role. `app_users`
  remains the only source of privilege.
* The storefront is deliberately outside the gate, so a missed Access rule can
  never stop a customer from paying. A *new* staff or private route without a
  rule is caught by `npm run test:frontend`, not by an outage.
* Nothing in the Worker requires Access to be enabled: with
  `CF_ACCESS_SSO` unset the previous password login keeps working unchanged.

## 1. Prerequisites

1. Zero Trust enabled on the account (free plan covers up to 50 users).
2. An IdP connected in **Zero Trust → Settings → Authentication**
   (Google Workspace, Microsoft Entra ID or Okta).
3. An IdP group (for example `mall-staff`) that contains every member of staff,
   and — if group claims are available — a second group for the owners,
   for example `idofera-super-admins`.

## 2. The Access applications

Create one **self-hosted** application per host name below, `Action: Allow`,
`Include: <your staff group>` (or an email-domain rule), `Session duration`
**8 hours or longer** (the app revalidates `/api/auth/session` every two
minutes while a workspace is open).

| Protected path pattern | Covers |
| --- | --- |
| `/labs*` | `/labs`, `/labs/dashboard`, `/labs/mall-orders`, … |
| `/app*` | the legacy staff routes |
| `/api/storage*` | `/api/storage/snapshot`, `/api/storage/records`, `/api/storage/d1/health` |
| `/api/ai*` | the AI assistant endpoints |
| `/api/staff*` | Mall Orders, Mall Listings, product images |
| `/api/auth/session` | the SSO bootstrap (Access must inject the JWT here) |
| `/api/auth/users*` | the staff roster |
| `/api/auth/password` | password changes and admin resets |

Hosts to cover: the live Worker (`idomall.olz.workers.dev`, or its custom
domain) **and** `idomall-preview.olz.workers.dev`, so a preview deployment is
never an unguarded copy of the staff workspace.

### Must stay anonymous — do not add these to any Access application

`/` and every storefront route (`/category/*`, `/product/*`, `/search`,
`/checkout`, `/orders`, `/order-success`), `/assets/*`, `/mall-images/*`,
`/api/health`, `/api/mall`, `/api/mall/*`, `/api/mall-webhook`,
`/api/auth/entrance`, `/api/auth/login`, `/api/auth/google`,
`/api/auth/logout`, and `/api/auth/session`'s sibling sign-in endpoints listed
here: `/api/auth/entrance`, `/api/auth/login`, `/api/auth/google`,
`/api/auth/logout`.

`/api/auth/entrance` is the cart-hold second factor: it is issued **from the
public storefront**, so covering it breaks the staff sign-in entirely.

Path syntax notes: no query strings, no ports, no `#`; `/labs/*` does not cover
`/labs` itself, which is why the code list uses `/labs*`; at most one wildcard
per path segment.

## 3. Configuration

Non-sensitive values live in `wrangler.toml`; the Audience tag is not a secret
either, but the service-token secret is.

| Variable | Purpose |
| --- | --- |
| `CF_ACCESS_SSO` | `"true"` enables the SSO session bootstrap. Anything else keeps the password login only. |
| `CF_ACCESS_TEAM_DOMAIN` | `https://<team-name>.cloudflareaccess.com`. Used for the JWKS URL and the `iss`/`aud` checks. |
| `CF_ACCESS_AUD` | The Access application's Audience (AUD) tag (Zero Trust → Access → Applications → your app → Overview). |
| `CF_ACCESS_SUPER_ADMIN_GROUP` | Optional. When set, the IdP must also assert this group before a super-admin session exists. Leave unset to disable the group requirement. |
| `CF_ACCESS_STEP_UP_SECONDS` | Optional. Step-up lifetime, default 600 seconds. |

Local `.env` mirrors the same names for `npm run dev`. Cloudflare secrets are
still set with `npx wrangler secret put --env mall <NAME>`; never pass them on
the command line (see `docs/mall-operations.md`).

### Service tokens for the deployment checks

`npm run verify:mall-preview` and `npm run verify:mall-contract` probe the
deployed origin anonymously. Create one Access service token (Zero Trust →
Access → Service credentials → Service tokens) with a `Service Auth` policy on
the same applications and export `CF_ACCESS_CLIENT_ID` /
`CF_ACCESS_CLIENT_SECRET` before running them; the scripts attach the
`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers when those variables
are present and treat an Access rejection (403, or a redirect to
`cloudflareaccess.com`) as "anonymous staff access denied" just like a 401.

## 4. Who is a Super Admin

Access proves an email address. **Privilege is still decided by the database:**

1. `app_users.is_super_admin` must be `1` (unchanged column, unchanged
   enforcement points, changed only through the audited
   `scripts/set-super-admin.ts`).
2. When `CF_ACCESS_SUPER_ADMIN_GROUP` is configured, the verified Access JWT
   must also carry that group (`accessGroupAllowed`).
3. Every privileged action additionally requires a **step-up**: a fresh proof of
   the caller's own password (`POST /api/auth/step-up`, 10-minute HttpOnly
   cookie, bound to the account that confirmed it).

The three gates are ANDed, so losing any one of them downgrades the session
rather than allowing the action. When a privileged request arrives without a
step-up it is answered
`403 {"error":"Confirm your password to continue.","code":"STEP_UP_REQUIRED"}`
and the client prompts instead of dead-ending.

Privileged actions gated this way:

| Action | Endpoint |
| --- | --- |
| Create or edit a staff account | `PUT /api/auth/users` |
| Delete a staff account | `DELETE /api/auth/users/:id` |
| Reset somebody else's password | `POST /api/auth/password` with `targetUserId` |
| Any change to a super-admin or protected account | the same endpoints, stricter check |

A staff member changing **their own** password keeps the existing
`oldPassword` verification and needs no step-up. The local password login
remains as break-glass and also requires a step-up before privileged actions,
so an operator can always recover administration without the IdP.

## 5. What staff see

With `CF_ACCESS_SSO="true"`, `GET /api/auth/session` verifies the Access JWT,
matches the email against `app_users`, and mints the normal app session. The
workspace opens directly — no second login screen, no separate password.

* **Email not registered** — the response is `{"user":null,"accessEmail":"…"}`
  and the sign-in screen explains that the account is not provisioned. Staff
  accounts are created by a super-admin; SSO never auto-creates a user.
* **Access session expired** — the session probe fails and the client performs
  a full-page navigation to `/labs`, which sends the browser back through the
  IdP. Keep the Access session duration well above the app's two-minute
  revalidation cadence.
* The cart-hold entrance and the password form stay available as the fallback
  path.

## 6. Auditing

* **Zero Trust → Insights → Logs → Access authentication logs** — per-login
  allow/deny with the user email, timestamp and application; the per-request
  log shows each protected path a user touched. Filter by application, user or
  decision; export with Logpush if you need retention.
* **`data/admin-flag-changes.log`** — super-admin flag changes made with
  `scripts/set-super-admin.ts`.
* Application-side events (staff actions on orders, listings) keep the
  `app_users.id` as the actor, so the audit trail is unchanged by SSO.

## 7. Joining, leaving and reconciliation

**Joining a new staff member**

1. Create the account in the workspace (super-admin, step-up required).
2. Add their email to `app_users` (the roster) and to the IdP staff group.

**Leaving**

1. Remove them from the IdP/Access group (removes the edge login).
2. `npx tsx scripts/set-super-admin.ts --id <userId> --value 0 --apply` when the
   account held the flag.
3. `npx tsx scripts/provision-admin.ts --revoke-sessions <userId>` — or set the
   account `status` to `Inactive`, which invalidates the app session even if a
   cookie survives.

**Reconcile before enabling SSO** — `docs/mall-launch-safety.md` records that
`usr-admin-1` still carries `is_super_admin = 1` in `idofera` while the client
displays that identity as a non-super-admin. Decide and apply the intended value
with the audited script before the flag becomes reachable through SSO.

## 8. Rollback

* **Fastest:** disable or delete the Access application. No deployment is
  needed; the app's own entrance + password login continue to work.
* **Keep Access, drop SSO:** set `CF_ACCESS_SSO = "false"` in `wrangler.toml`
  and redeploy `--env mall`. The JWT is still verified for identity logging, but
  no session is minted from it.
* **Drop the group / step-up requirement:** clear
  `CF_ACCESS_SUPER_ADMIN_GROUP` (the step-up requirement itself is deliberate
  and should stay).

## 9. Verification checklist

1. `npm run lint && npm run test:frontend && npm run test:mall-backend && npm run test:access`.
2. Local: `npx wrangler dev --env mall` — storefront browse/cart/checkout, the
   cart-hold entrance, and the password login all unchanged.
3. Decode a real Access token for a test staff account and confirm the group
   claim is present; if the IdP cannot assert groups, either enable group claims
   on the IdP application or leave `CF_ACCESS_SUPER_ADMIN_GROUP` unset (the
   step-up gate then carries the whole requirement).
4. Deploy `--env preview`, then `npm run verify:mall-preview` and
   `npm run verify:mall-contract` with the service-token variables exported.
5. Live checks after `npx wrangler deploy --env mall`:
   * `/labs` anonymously → IdP login, never the workspace.
   * SSO staff account → workspace without a password prompt.
   * `curl -i https://idomall<…>.workers.dev/api/staff/mall-orders` → 302/403.
   * Delete-a-user attempt → `STEP_UP_REQUIRED`, then succeeds after the
     password prompt.
   * Access logs show the allow decision with the staff email.

## 10. Known gaps

* Network access to the Worker is unchanged: Access is an authentication gate,
  not a network control (there is no exposed origin port to protect — the Worker
  is the origin, so no Cloudflare Tunnel is involved).
* Access authenticates, it does not authorize: role checks, refund/dispatch
  permissions and the super-admin rules above all stay in the application.
* The Access applications themselves are dashboard state. `STAFF_ACCESS_PATHS`
  and `scripts/staff-access.test.ts` catch drift in this repository, but nobody
  can detect a dashboard-only change without the optional
  `npm run verify:access-apps` check (`scripts/verify-access-apps.ts`, needs a
  read-only API token with `Access: Apps and Policies Read`; it skips cleanly
  when `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` are not exported).


