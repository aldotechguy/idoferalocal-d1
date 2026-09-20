# Mall operations and activation

## What is automated vs human work

The Mall can accept orders while the shop is unattended, queue notifications,
retry delivery, alert about stalled work, expire unpaid orders, and release stock.
It does NOT independently verify a bank deposit, pack goods, verify a delivery
address, assign a real courier, or physically receive returns. Those remain
authorized staff actions. A webhook receiver must route events to the appropriate
staff/customer channel and monitor heartbeat/readiness failures.

## Activation configuration (both Node and Worker)

All values are server configuration, not browser inputs:

- `MALL_CHECKOUT_ENABLED=true` — explicit switch to accept new orders.
- `MALL_BANK_NAME`, `MALL_BANK_ACCOUNT_NAME`, `MALL_BANK_ACCOUNT_NUMBER` (10 digits).
- `MALL_PICKUP_ADDRESS`, `MALL_PICKUP_HOURS`.
- `MALL_WEBHOOK_URL` — trusted HTTPS receiver, no redirects or URL credentials.
- `MALL_WEBHOOK_SECRET` — randomly generated, at least 32 characters; secret binding.
- `MALL_UNPAID_EXPIRY_HOURS` — default 48; supported 1–720.

Never commit real bank configuration or secrets. These were NOT populated by the
implementation. Existing administrator credentials and sessions still require
rotation/revocation if they originated from the old default-account seed.

Secrets are injected per-environment through Wrangler (not committed). `wrangler.toml`
defines the live `mall` environment (`name = "idomall"`), backed by relational D1
`idofera` and the `idomall` R2 image bucket. Deploy against it with
`npx wrangler deploy --env mall`; develop locally with `npx wrangler dev --env mall`.
Set all Mall secrets as Wrangler variables on the `mall` environment — never pass them
on the public command line. A local `.env` mirrors the variable names and is the
canonical list of required secrets; verify it is git-ignored before deployment.
configured five-minute Cron Trigger for both environments. Verify cron deployment
and an external process supervisor for Node. At most one expired order is processed
per maintenance invocation to bound database work; oldest orders are processed first.
Monitor the expiry backlog and increase throughput deliberately if volume requires it.

## Readiness and monitoring

- `GET /api/mall/health`: liveness (not launch approval).
- `GET /api/mall/ready`: 200 only when dependency/configuration checks pass; otherwise 503.
- Staff Mall Orders shows readiness, notification counts, order timelines, and retry
  controls. Management API: `GET /api/staff/mall-orders/operations`.
- Readiness requires required schema objects, a recent successful scheduler run,
  bank/pickup configuration, webhook configuration, a recorded successful webhook
  delivery, no dead/old undelivered notifications, and checkout enabled.
- Checkout/conflict/error counters are daily aggregates without customer PII.
- The configured webhook receives hourly `MALL_HEARTBEAT` events. Configure an
  independent monitor for missing heartbeats and readiness failures. An outage of
  the webhook itself cannot be reported reliably through that same webhook.
- In the deployed Mall Worker the receiver emails the operator, so readiness implies a
  real message has been accepted by the email provider at least once — not merely that a
  webhook URL is configured. See "Email notifications (deployed receiver)" below.
- Configure platform exception/D1 error alerts in Cloudflare, and log collection/
  process-restart alerts for Node. Observability configuration is in Wrangler, but
  alert destinations and dashboard rules must be set in the deployment account.

## Webhook receiver contract

POST JSON containing `id`, `event`, `occurredAt`, `data`, `order`, and `instructions`.
`data` is the event-time snapshot; `order` is the current order at send time and may
already reflect a later transition. Do not assume delivery order is chronological.
Current order data contains customer name/phone/email for notification routing.
The order also includes payment reference/status/method and fulfilment JSON so the
receiver can distinguish payment instructions, pickup, and delivery notifications.
Treat the delivery address in that JSON as private customer information. Restrict
receiver access and retention; do not log full payloads or bank/customer details.

Headers:

- `x-mall-event-id`: stable event ID; deduplicate on this ID.
- `x-mall-timestamp`: Unix seconds.
- `x-mall-signature`: `sha256=` followed by hex HMAC-SHA256 of
  **timestamp + '.' + exact raw request body**, using the configured secret.

The receiver must verify the signature in constant time, reject stale timestamps
(suggested five-minute tolerance), durably accept/deduplicate the event, then return
2xx. Route staff alerts and customer status/instruction messages using the selected
provider. A 2xx acknowledges receiver acceptance, not actual SMS/WhatsApp delivery;
the receiver is responsible for downstream provider retries and delivery reporting.

Sender delivery is at least once, not exactly once. A two-minute lease prevents
simultaneous sends, but a crash after receiver acceptance can cause a retry.
Timeout is ten seconds. Failed attempts back off exponentially up to one hour;
after ten failed attempts the event is dead-lettered. Managers can explicitly retry
dead letters. Successful deliveries are retained for 30 days; undelivered events
are not silently removed. The receiver URL is privileged configuration: never point
it at an internal/private endpoint or accept it from public input.

## Email notifications (deployed receiver)

The deployed Worker is its own webhook receiver: `POST /api/mall-webhook`. It is public
but not unauthenticated — every request must carry a valid `sha256=` HMAC signature, so
it must stay exempt from the staff-entrance gate (a staff cookie cannot be presented by
the scheduler) while never being reachable without the signature check.

Delivery is IN PROCESS. The five-minute scheduler builds the signed POST and hands it
straight to the receiver function instead of fetching `MALL_WEBHOOK_URL` over the
network. The URL is a hostname this Worker's own route matches, and Cloudflare answers a
self-referential fetch with error 1042 ("Internal request count exceeded") once the
subrequest chain grows. The endpoint is still served publicly so an external monitor or
integration can post signed events independently.

Resend configuration:

- `MALL_EMAIL_FROM` (var, non-sensitive): the `From` address. Resend only accepts senders
  on a domain you have verified at resend.com/domains. The default sandbox sender
  `onboarding@resend.dev` works without DNS but can deliver ONLY to the Resend account
  owner's own address; set `MALL_NOTIFY_EMAIL` to that address, or verify a domain and
  switch `MALL_EMAIL_FROM` to it for a branded sender and any recipient.
- `MALL_NOTIFY_EMAIL` (secret): the operator mailbox receiving order events.
- `RESEND_API_KEY` (secret): a valid key. A revoked/invalid key fails as HTTP 502 with
  Resend's error captured (see below), not as a silent success.
- `MALL_WEBHOOK_SECRET` (secret, 32+ chars) and `MALL_WEBHOOK_URL` (var): the HMAC secret
  and the URL used as the signed request identity. Secrets are set with
  `npx wrangler secret put --env mall <NAME>` and are never committed; only
  non-sensitive values belong in `[env.mall.vars]`.

Behaviour and diagnostics:

- Checkout collects an OPTIONAL customer email (validated and lowercased server-side;
  omitted emails keep checkout working). When an order carries one, every order event
  emails a second, customer-facing copy with a friendly greeting, the order status, and
  — for unpaid bank transfers — the payment instructions, or the pickup address/hours.
  The copy is best-effort: the operator acknowledgement is authoritative, so a failed
  customer send never retries the event (and never duplicates the operator email); the
  failure stays visible in `mall_webhook_deliveries.error`.
- Hourly `MALL_HEARTBEAT` events are acknowledged and recorded but never emailed, so the
  signed wire is provably up without one message per hour forever.
- Order events (received, paid, dispatched, delivered, cancelled, refunded) email the
  operator with order number, customer, total, status and payment state.
- `mall_webhook_deliveries` deduplicates on the event ID for seven days, so a retry after
  a crash or a lost 2xx re-acknowledges instead of emailing twice. Recording a delivery is
  best-effort: a bookkeeping failure must never turn a sent email into a retry.
- `mall_outbox.last_error` stores the real failure cause (for example `HTTP 502`) and
  `mall_webhook_deliveries.error` stores the provider's raw error body. Read those two
  columns first when notifications stop; both previously collapsed into one constant
  string that could not distinguish a bad signature from an unverified sender domain.

## Lifecycle and returns

Order state machine:

`pending -> confirmed -> processing -> packed -> ready_for_pickup -> completed`

Delivery branch: `packed -> out_for_delivery -> completed`.

Settlement may move pending/confirmed directly to processing. Payment status is
separate; it becomes paid atomically with sale/accounting creation. Unpaid pending/
confirmed orders can be cancelled. Paid orders use full refund. Each material action
has an actor and timestamp in `mall_order_events`; historical creation/audit dates
are imported, but timestamps never previously recorded cannot be reconstructed.

Delivery orders require staff verification of address/zone serviceability before
confirmation or payment. Other-location quotes must also be confirmed. Dispatch
requires a courier. Pickup orders cannot dispatch, delivery orders cannot enter the
pickup branch. Mall completion/refund synchronizes the related delivery row; direct
conflicting changes through the generic delivery model are rejected.

Refunds require a reason and explicit stock disposition. Restocking goods after
dispatch or customer collection requires a goods-received reference. The return
record persists disposition, reference, reason, actor, and time. Partial refunds,
partial returns and physical reverse-logistics integrations are not implemented.

Unverified/rejected transfers can be cancelled by managers; this cancels the pending
payment and releases stock rather than pretending money was received. Late bank
receipts after cancellation require manual exception handling; never reactivate a
cancelled order automatically. Customers must not pay again without contacting staff.

## Schema rollout and legacy data

Operational DDL is additive and applied atomically after the base tables, before
traffic is accepted. Unique active-session and cart/product indexes deliberately
fail migration if existing duplicates exist: inspect and reconcile them before
retrying, rather than silently deleting/merging customer carts. Trigger constraints
protect future writes; they do not certify all historical rows as valid.

Phone matching uses one shared normalization policy and indexed SQL expressions.
This indexes normalized legacy values without overwriting historical contact data.
Malformed legacy numbers are not matched; correct them through authorized maintenance.
Public tracking requires exact order number plus normalized phone; phone-only lookup
is rejected. This is a minimal privacy control, not customer authentication.

Rate limits are shared database-backed minute windows keyed by a hash of the trusted
runtime IP: checkout 10, tracking 5, cart 60, catalog 120 per minute. The public order
lookup (`GET /api/mall/orders`, phone + order number) is throttled more strictly than
checkout because it is a phone-enumeration vector; exact order number plus normalized
phone is a minimal privacy control, not customer authentication. Worker takes the
Cloudflare IP; Node uses its connection IP (no untrusted forwarded headers). If Node
is behind a proxy, configure/verify trusted-proxy behavior carefully to avoid all
customers sharing one limit. Add perimeter Cloudflare abuse controls before high-volume
launch; database rate limiting itself consumes database operations.

## Catalog filtering, sorting and pagination

The public catalog (`GET /api/mall/products`) is filtered and sorted SERVER-SIDE.
Supported query parameters:

- `q` (name/SKU search), `category`, `brand` (exact), `inStock=true`.
- `sort`: `newest` (default), `price_asc`, `price_desc`, `name_asc` — values are
  validated against a whitelist; anything else falls back to `newest`.
- `limit` (default 24, max 100) and `offset` (capped at 10,000).

The response reports `total` for the filtered set, plus `brands` facets for the
active filters. Storefront price is always server-computed: an active promo price
window wins, then `mall_price_kobo`, then `retail_price_kobo`. The promo window is
stored as ISO-8601 UTC millisecond strings and compared against a parameter-free
`strftime('now')` expression so results do not depend on request-supplied clocks.

## Staff Mall merchandising (Mall Listings)

Policy (decided): **Active product status is the single visibility rule.** Every
Active product appears on the Mall automatically; there is no separate publish
approval. Hiding a product means setting its status to Inactive/Archived in
product management. Legacy `is_mall_listed` values are ignored by the storefront.
Purchasing additionally requires stock and a valid price (active promo -> Mall
price -> retail price, always above the product floor).

API (staff session required):

- `GET /api/staff/mall-listings?q=&view=all|active|hidden&limit=&offset=` -
  listings with advisory per-item `issues` (missing image, no stock, `data:`
  images, unpriced). Readable by Administrator/Store Manager/Sales Staff/Accountant.
- `GET /api/staff/mall-listings/:id` - single listing plus a preview of exactly
  how the public catalog renders it right now (`visibleOnMall`, effective price,
  availability).
- `PUT /api/staff/mall-listings/:id` - Administrator or Store Manager only.
  Body: `mallPriceKobo`, `mallDescription`, `featured`, `displayOrder`,
  `promoPriceKobo`, `promoStart`, `promoEnd`. Sending `publish` returns 400.

Server-enforced merchandising rules: Mall price must be a positive whole number
of kobo and never below the product floor (`min_selling_price_kobo`). A promo
price must be lower than the normal Mall price, within the floor, and its window
must end after it starts. Mall description is capped (2,000 chars, control
characters rejected). Saves use optimistic concurrency: if another editor changed
the listing first, the second writer gets `409` and must reload. Every save
writes an `UPDATE_MALL_LISTING` audit entry.

Auditing never throws for advisory issues: the list still renders products that
lack images or stock so staff can fix or restock them; buying is blocked by the
stock/price rules regardless. The legacy hero seed no longer runs by default;
set `MALL_SEED_HEROES=true` to opt in (any other value logs a warning and skips).

## Durable product image storage

Product images no longer live as base64 `data:` URLs in the database. `AddProductModal`
 downscales in the browser to WebP (canvas) and uploads via the staff image API:

- `POST /api/staff/product-images` (staff session; Administrator/Store Manager/
  Sales Staff) with `multipart/form-data` or raw binary — server caps at 4 MB,
  validates MIME type AND magic bytes (jpeg/png/webp/gif), rejects mismatched
  forged types, and stores under an unguessable key `products/YYYY-MM/<uuid>.<ext>`.
- `DELETE /api/staff/product-images/<key>` — same roles.
- Public GET: `/mall-images/<key>` served with immutable cache headers.

Storage backends: the Node server writes to disk under `MALL_IMAGE_DIR`
(default `data/mall-images`); the Worker uses the R2 binding `MALL_IMAGES`.
For the live `mall` Cloudflare Worker environment, the existing bucket is `idomall`.
Bind it as shown below; there is no need to create it again. For a new account:

```bash
wrangler r2 bucket create idomall
```

and in `wrangler.toml`:

```toml
[[env.mall.r2_buckets]]
binding = "MALL_IMAGES"
bucket_name = "idomall"
```

The `mall` environment is now the live target: Worker `idofera-mall-preview`
(existing name retained), database `idofera`, and image bucket `idomall`.
Use `--env mall` for deployment. It is no longer a disposable preview.
The default target remains separate. Future preview environments must use isolated
databases and buckets. Build frontend assets with `npx vite build` before deploying;
do not upload the Node server bundle as a public static asset.

Images uploaded before this change (base64 in `images_json`) remain renderable,
but a listing that still contains any `data:` URL is flagged in Mall Listings
until staff re-upload those images through the new flow; buying separately
requires an Active status, stock, and a valid price.

## Verification boundary

Local tests run real SQL through Node and a D1-shaped adapter using the actual
Worker handler. Maximum-cart, lifecycle, rollback, catalog/cart, normalized tracking,
webhook signature/retry/lease, expiry, constraints, configuration and readiness tests
are included. This is NOT a deployed D1/workerd certification.

`npm run verify:mall-preview` runs read-only checks against an explicitly configured
`MALL_PREVIEW_BASE_URL` HTTPS origin. It checks storefront routing, catalog/health,
anonymous staff access rejection, phone-only lookup rejection and readiness. It
does not create orders or mutate stock. No preview URL was supplied or tested.

Before activation: back up the database; inspect duplicate/invalid legacy records;
apply the change in a disposable preview; test maximum intended order size under
the actual Workers plan; configure secrets; verify real receiver signatures and
downstream customer/staff messages; observe cron and heartbeat; rehearse payment,
dispatch, return, and notification-retry workflows; verify administrator rotation.
Do not declare unattended-ready until these deployment gates are satisfied.

No production build, deployment, external webhook request, real payment, or production
database mutation was performed as part of local implementation/testing.