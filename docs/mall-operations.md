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

Node uses a one-minute interval while the process is running. Worker uses the
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
- Configure platform exception/D1 error alerts in Cloudflare, and log collection/
  process-restart alerts for Node. Observability configuration is in Wrangler, but
  alert destinations and dashboard rules must be set in the deployment account.

## Webhook receiver contract

POST JSON containing `id`, `event`, `occurredAt`, `data`, `order`, and `instructions`.
`data` is the event-time snapshot; `order` is the current order at send time and may
already reflect a later transition. Do not assume delivery order is chronological.
Current order data contains customer name/phone for notification routing.
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
runtime IP: checkout/tracking 10, cart 60, catalog 120 per minute. Worker takes the
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

## Staff Mall publishing workflow (Mall Listings)

Staff manage storefront visibility in **Products & Stock → "Mall Listings"**.

API (staff session required):

- `GET /api/staff/mall-listings?q=&view=all|listed|unlisted&limit=&offset=` —
  listings with per-item `blockPublish` issues and `canPublish`. Readable by
  Administrator/Store Manager/Sales Staff/Accountant.
- `GET /api/staff/mall-listings/:id` — single listing plus a preview of exactly
  how the public catalog renders it right now (`visibleOnMall`, effective price).
- `PUT /api/staff/mall-listings/:id` — Administrator or Store Manager only.
  Body: `publish`, `mallPriceKobo`, `mallDescription`, `featured`, `displayOrder`,
  `promoPriceKobo`, `promoStart`, `promoEnd`.

Server-enforced publish rules: product status Active, stock > 0, at least one
image, no `data:` embedded images, price > 0 and never below the product floor
(`min_selling_price_kobo`). A promo price must be lower than the normal Mall
price, within the floor, and its window must end after it starts. Mall
description is capped (2,000 chars, control characters rejected). Saves use
optimistic concurrency (`mall_write_guards`-style assertion): if another editor
changed the listing first, the second writer gets `409` and must reload. Every
publish/unpublish/update writes an audit log entry
(`PUBLISH_MALL_LISTING` / `UNPUBLISH_MALL_LISTING` / `UPDATE_MALL_LISTING`).

Auditing an already-published product never throws: if it develops new blockers
(e.g. stock drains to zero), the list still renders it with the issues shown so
staff can unpublish or restock. The legacy hero seed no longer runs by default;
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
For Cloudflare deployment, create the bucket and bind it, e.g.:

```bash
wrangler r2 bucket create idofera-mall-images
```

and in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "MALL_IMAGES"
bucket_name = "idofera-mall-images"
```

Images uploaded before this change (base64 in `images_json`) remain renderable,
but a listing that still contains any `data:` URL is blocked from publishing
until staff re-upload those images through the new flow.

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