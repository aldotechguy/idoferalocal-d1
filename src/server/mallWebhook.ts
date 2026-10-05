/**
 * #18 — email notification webhook receiver for the Mall.
 *
 * The receiver used to live inside `sites-worker.ts` only, so the Node runtime
 * (`server.ts`) had no `/api/mall-webhook` route: its scheduled outbox drain
 * fetched `MALL_WEBHOOK_URL` and got a 404, then retried and dead-lettered every
 * order event. Nothing was ever emailed. The handler is runtime-neutral, so both
 * runtimes import THIS module: the Worker passes its D1 database, the Node server
 * passes a `node:sqlite` shim that exposes the same `.prepare().bind()` surface.
 *
 * The receiver is public but not unauthenticated: every request must carry a
 * valid `sha256=` HMAC signature, so it stays exempt from the staff-entrance gate
 * (a scheduler cannot present a staff cookie) without ever being reachable
 * without the signature check.
 */
import { signMallWebhook, type MallConfig } from './mallOperations.js';

/** The subset of D1 the receiver needs; a `node:sqlite` shim provides the same shape. */
export interface WebhookStatement {
  bind(...values: unknown[]): WebhookStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}
export interface WebhookDatabase {
  prepare(query: string): WebhookStatement;
}

export interface WebhookEnv extends MallConfig {
  DB: WebhookDatabase;
  RESEND_API_KEY?: string;
  MALL_NOTIFY_EMAIL?: string;
  MALL_EMAIL_FROM?: string;
  MALL_EMAIL_REPLY_TO?: string;
}

interface MallWebhookOrder {
  order_no?: string;
  customer_phone?: string;
  customer_name?: string;
  customer_email?: string;
  total_kobo?: number;
  status?: string;
  delivery_address_json?: string;
  payment_status?: string;
  payment_method?: string;
}

export interface MallWebhookBody {
  id: string;
  event: string;
  occurredAt?: string;
  data?: Record<string, unknown>;
  order?: MallWebhookOrder;
  instructions?: Record<string, unknown>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

/**
 * A canonical Mall notification event: the name stored in the delivery ledger,
 * the label the operator reads, and whether the buyer is told.
 */
export interface MallEventSpec {
  /** Stable name persisted in `mall_webhook_deliveries.event`. */
  event: string;
  /** Human-readable label used in the subject line. */
  label: string;
  /** Whether a buyer with a usable address receives a copy. */
  customer: boolean;
}

/**
 * Why this lives in the receiver and not in the `mall_order_audited` trigger:
 * the DDL is `CREATE TRIGGER IF NOT EXISTS`, so editing the trigger string is a
 * no-op on the deployed database, and it would not repair rows ALREADY queued
 * in `mall_outbox` under a raw audit action. Resolving here fixes both, needs no
 * migration, and is safe for retries because dedupe keys on the outbox row id
 * (`event_id`), never on the event name.
 *
 * `MALL_AUDIT_ACTIONS` is the whole vocabulary the audit trigger can emit: the
 * trigger copies `audit_logs.action` verbatim into `mall_outbox.event`.
 */
const MALL_EVENTS: Record<string, Omit<MallEventSpec, 'event'>> = {
  ORDER_RECEIVED: { label: 'Order received', customer: true },
  ORDER_CONFIRMED: { label: 'Order confirmed', customer: true },
  ORDER_PAID: { label: 'Payment confirmed', customer: true },
  ORDER_DISPATCHED: { label: 'Order dispatched', customer: true },
  ORDER_DELIVERED: { label: 'Order delivered', customer: true },
  ORDER_CANCELLED: { label: 'Order cancelled', customer: true },
  ORDER_REFUNDED: { label: 'Order refunded', customer: true },
  // Internal bookkeeping: the buyer already sees the resulting invoice, and a
  // second "your order" email for it is noise, not information.
  ORDER_INVOICED: { label: 'Order converted to invoice', customer: false },
  ORDER_PREPARING: { label: 'Order being prepared', customer: true },
  ORDER_UPDATED: { label: 'Order status updated', customer: false },
  DELIVERY_VERIFIED: { label: 'Delivery address verified', customer: false },
  DELIVERY_QUOTED: { label: 'Delivery quoted', customer: false },
  STAFF_ATTENTION_REQUIRED: { label: 'Order needs staff attention', customer: false },
};

/** Audit action -> canonical event. */
const MALL_AUDIT_ACTIONS: Record<string, string> = {
  ORDER_RECEIVED: 'ORDER_RECEIVED',
  CONFIRM_MALL_ORDER: 'ORDER_CONFIRMED',
  CANCEL_MALL_ORDER: 'ORDER_CANCELLED',
  REFUND_MALL_ORDER: 'ORDER_REFUNDED',
  CONVERT_MALL_ORDER_SALE: 'ORDER_INVOICED',
  VERIFY_MALL_DELIVERY: 'DELIVERY_VERIFIED',
  QUOTE_MALL_DELIVERY: 'DELIVERY_QUOTED',
  STAFF_ATTENTION_REQUIRED: 'STAFF_ATTENTION_REQUIRED',
};

/**
 * `UPDATE_MALL_ORDER_STATUS` is the catch-all for every order transition, so the
 * event name alone does not say which one happened. Keyed on the order status.
 * Transitions the buyer would ask about map to a customer copy; the routine
 * `confirmed`/`processing` steps stay operator-only to keep volume down.
 */
const MALL_STATUS_EVENTS: Record<string, string> = {
  out_for_delivery: 'ORDER_DISPATCHED',
  completed: 'ORDER_DELIVERED',
  cancelled: 'ORDER_CANCELLED',
  refunded: 'ORDER_REFUNDED',
  packed: 'ORDER_PREPARING',
  ready_for_pickup: 'ORDER_PREPARING',
};

/**
 * Resolve a raw outbox event into its canonical spec. Never throws: an
 * unrecognised event still emails the operator under its raw name, because
 * failing here would turn an already-sent delivery into an outbox retry and
 * email the operator a second time. Unknown events are never customer-facing.
 *
 * `data` is the payload captured by the trigger at event time; `liveStatus` is
 * the order status read at SEND time. `data.status` must win: the drain runs on
 * a cron with exponential retry, so an `out_for_delivery` event can
 * be delivered minutes later, after the order already reached `completed`.
 * Reading the live row there would mislabel a dispatch as a delivery.
 */
export function resolveMallEvent(
  rawEvent: string,
  data?: Record<string, unknown>,
  liveStatus?: string,
): MallEventSpec {
  let canonical: string | undefined = MALL_AUDIT_ACTIONS[rawEvent];
  if (!canonical && rawEvent === 'UPDATE_MALL_ORDER_STATUS') {
    const status = typeof data?.status === 'string' ? data.status : liveStatus;
    canonical = (status && MALL_STATUS_EVENTS[status]) || 'ORDER_UPDATED';
  }
  if (!canonical) canonical = MALL_EVENTS[rawEvent] ? rawEvent : undefined;
  const spec = canonical ? MALL_EVENTS[canonical] : undefined;
  return spec
    ? { event: canonical, label: spec.label, customer: spec.customer }
    : { event: rawEvent, label: rawEvent, customer: false };
}

export async function handleMallWebhook(request: Request, env: WebhookEnv): Promise<Response> {
  const bodyText = await request.text();

  // Verify HMAC signature using the constant-time helper.
  const secret = env.MALL_WEBHOOK_SECRET || '';
  const expectedSig = request.headers.get('x-mall-signature') || '';
  const providedSig = expectedSig.startsWith('sha256=') ? expectedSig.slice(7) : expectedSig;
  const timestampHeader = request.headers.get('x-mall-timestamp') || '';
  const expected = await signMallWebhook(secret, timestampHeader, bodyText);
  if (!providedSig || !safeEqual(providedSig, expected)) {
    return json({ error: 'Signature verification failed.' }, 401);
  }

  // Reject stale timestamps (>5 min old).
  const ts = Number(timestampHeader);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return json({ error: 'Request timestamp outside tolerance window.' }, 400);
  }

  let parsed: MallWebhookBody;
  try {
    parsed = JSON.parse(bodyText) as MallWebhookBody;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!parsed.id) return json({ error: 'Missing event id.' }, 400);

  // Idempotency: an outbox row id is stable across retries, so the event id is
  // the dedupe key. `delivered_at` is ISO-8601 text, so the 7-day window is an
  // ISO string too — comparing text against epoch millis would compare across
  // SQLite storage classes and never expire.
  const existing = await env.DB.prepare(
    'SELECT id FROM mall_webhook_deliveries WHERE event_id=? AND delivered_at >= ? LIMIT 1',
  ).bind(parsed.id, new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()).all<{ id: string }>();
  if (existing.results && existing.results.length > 0) {
    return json({ status: 'already_delivered' });
  }

  // Delivery bookkeeping is deliberately best-effort: a failed audit insert must
  // never fail the delivery, or the outbox would retry and email twice. Writes
  // use .run() like the rest of this Worker (D1 executes writes that way).
  const record = async (sql: string, params: unknown[]) => {
    try { await env.DB.prepare(sql).bind(...params).run(); } catch { /* audit only */ }
  };

  // Insert a delivery row. The column lists are fixed, so the placeholder count
  // is derived from the values instead of being hand-typed (a stale literal
  // silently broke every delivery row insert).
  const recordDelivery = (columns: string[], values: unknown[]) =>
    record(`INSERT INTO mall_webhook_deliveries(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, values);

  // MALL_HEARTBEAT is an hourly liveness probe, not a customer event: it proves
  // the signed wire is up but must not email the operator 24 times a day.
  if (parsed.event === 'MALL_HEARTBEAT') {
    await recordDelivery(
      ['id', 'event_id', 'event', 'status', 'delivered_at'],
      [crypto.randomUUID(), parsed.id, parsed.event, 'sent', new Date().toISOString()],
    );
    return json({ status: 'acknowledged', event: parsed.event });
  }

  // Build the emails and send via Resend.
  const operator = env.MALL_NOTIFY_EMAIL;
  if (!operator || !env.RESEND_API_KEY) {
    return json({ error: 'Email notification is not fully configured on the Worker.' }, 503);
  }

  const order = parsed.order || {};
  const orderNo = order.order_no || parsed.id;
  // `order.status` is read live at send time; the resolver prefers the
  // event-time `data.status` so a delayed dispatch is not read as a delivery.
  const { event, label, customer } = resolveMallEvent(parsed.event, parsed.data, order.status);
  const totalNgn = order.total_kobo
    ? (order.total_kobo / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })
    : '—';
  const from = env.MALL_EMAIL_FROM || 'Mall Orders <onboarding@resend.dev>';
  // Deliverability: a plain-text alternative and a real Reply-To measurably
  // reduce spam classifications for transactional mail from a young domain.
  // Gmail treats an HTML-only body from a low-reputation sender as a negative
  // signal, and an unreciprocated address (no way to reply) as another.
  const replyTo = env.MALL_EMAIL_REPLY_TO || operator;
  const sendEmail = (to: string, subject: string, html: string, text: string) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        // Resend only accepts senders on a domain you have verified. Until a real
        // domain is verified, `onboarding@resend.dev` is the sandbox sender (it can
        // only deliver to the Resend account owner's own address).
        from,
        to: [to],
        reply_to: replyTo,
        subject,
        html,
        text,
        headers: {
          // One-click unsubscribe is expected from senders and downgrades a
          // complaint into a harmless opt-out. Mailto is a valid fallback when
          // no unsubscribe URL/endpoint exists yet.
          'List-Unsubscribe': `<mailto:${operator}?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });

  const operatorHtml = emailTemplate({
    event, label,
    orderNo,
    customerName: order.customer_name || 'unknown',
    customerPhone: order.customer_phone || 'unavailable',
    totalNgn,
    status: order.status,
    paymentStatus: order.payment_status || 'unavailable',
    paymentMethod: order.payment_method || 'unavailable',
    occurredAt: parsed.occurredAt,
    instructions: parsed.instructions,
  });
  const resendRes = await sendEmail(
    operator,
    `[Mall] ${label} — Order ${orderNo}`,
    operatorHtml,
    textFromHtml(operatorHtml),
  );

  const deliveryId = crypto.randomUUID();
  if (!resendRes.ok) {
    const errText = await resendRes.text();
    await recordDelivery(
      ['id', 'event_id', 'event', 'status', 'error', 'delivered_at'],
      [deliveryId, parsed.id, event, 'failed', errText, null],
    );
    return json({ error: 'Failed to send email', detail: errText }, 502);
  }

  // Customer copy (best-effort). The operator acknowledgement above is
  // authoritative: a failed customer send must NOT fail the delivery, or the
  // outbox retry would email the operator twice. Failures stay observable in the
  // delivery row's error column instead.
  const customerEmail = typeof order.customer_email === 'string' ? order.customer_email.trim().toLowerCase() : '';
  let customerError = '';
  let customerOutcome = 'none';
  if (customerEmail) {
    // A skip reason must name the real cause. Both used to report "the stored
    // address did not pass format validation", which is a lie for an event that
    // was never meant for the buyer — and this column is the first thing the
    // docs tell an operator to read when notifications stop.
    if (!customer) {
      customerOutcome = 'skipped';
      customerError = `Customer copy skipped: ${event} is an internal staff event, not a buyer update.`;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      customerOutcome = 'skipped';
      customerError = 'Customer copy skipped: the stored address did not pass format validation.';
    } else {
      const customerHtml = customerEmailTemplate({
        label, orderNo,
        customerName: order.customer_name || '',
        totalNgn,
        status: order.status,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        instructions: parsed.instructions,
      });
      const customerRes = await sendEmail(
        customerEmail,
        `${label} — your order ${orderNo}`,
        customerHtml,
        textFromHtml(customerHtml),
      );
      if (customerRes.ok) {
        customerOutcome = 'sent';
        await customerRes.body?.cancel();
      } else {
        customerOutcome = 'failed';
        customerError = `Customer copy failed: ${(await customerRes.text()).slice(0, 300)}`;
      }
    }
  }

  const deliveredAt = new Date().toISOString();
  await recordDelivery(
    ['id', 'event_id', 'event', 'status', 'error', 'delivered_at'],
    [deliveryId, parsed.id, event, 'sent', customerError || null, deliveredAt],
  );

  return json({ status: 'sent', eventId: parsed.id, deliveredAt, customer: customerOutcome });
}

/**
 * A minimal, dependency-free HTML-to-text projection for the plain-text part.
 * Transactional mail should never ship HTML-only: Gmail treats a missing text/
 * alternative from a young/low-reputation domain as a spam signal. This strips
 * tags, decodes the handful of entities these templates emit, and keeps table
 * rows on their own lines so the text part stays readable.
 */
export function textFromHtml(html: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
  };
  return html
    .replace(/<(style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|li)>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z#0-9]+;/gi, (m) => entities[m.toLowerCase()] ?? m)
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
}

const EMAIL_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #333; }
  .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
  .header { background: #6c5ce0; color: #fff; padding: 20px; }
  .header h1 { margin: 0; font-size: 20px; }
  .body { padding: 20px; }
  .body table { width: 100%; border-collapse: collapse; }
  .body td { padding: 8px 12px; border-bottom: 1px solid #eee; }
  .body td:first-child { font-weight: 600; color: #555; }
  .footer { padding: 16px 20px; background: #f8f9fa; font-size: 12px; color: #888; }
`;

export function emailTemplate(params: {
  event: string;
  label: string;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  totalNgn: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  occurredAt?: string;
  instructions?: Record<string, unknown>;
}): string {
  // Buyer-controlled fields (customerName, orderNo, phone) are interpolated into
  // HTML here, so they are escaped exactly like the customer template. Without
  // escaping, a name like "Ada <script>" injected arbitrary HTML into the
  // operator's transactional email — a spoofing/phishing vector into the
  // account that fulfils orders.
  const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => escapes[ch] || ch);
  const fmt = (v: string | undefined) => v ? String(v).replace(/_/g, ' ') : '—';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${EMAIL_CSS}</style></head>
<body>
 <div class="container">
    <div class="header"><h1>${esc(params.label)} — Order ${esc(params.orderNo)}</h1></div>
    <div class="body">
      <table>
        <tr><td>Event</td><td>${esc(params.event)}</td></tr>
        <tr><td>Order #</td><td>${esc(params.orderNo)}</td></tr>
        <tr><td>Customer</td><td>${esc(params.customerName)}</td></tr>
        <tr><td>Phone</td><td>${esc(params.customerPhone)}</td></tr>
        <tr><td>Total</td><td>${esc(params.totalNgn)}</td></tr>
        <tr><td>Order Status</td><td>${esc(fmt(params.status))}</td></tr>
        <tr><td>Payment</td><td>${esc(fmt(params.paymentMethod))} — ${esc(fmt(params.paymentStatus))}</td></tr>
        <tr><td>Occurred At</td><td>${esc(params.occurredAt || '—')}</td></tr>
      </table>
    </div>
    <div class="footer">This is an automated notification from the Mall system. Do not reply to this email.</div>
 </div>
</body>
</html>`;
}

/**
 * Customer-facing copy. Friendlier than the operator email: no internal event
 * plumbing, every customer-provided value escaped, and payment/pickup
 * instructions included exactly when they are actionable for the customer.
 */
export function customerEmailTemplate(params: {
  label: string;
  orderNo: string;
  customerName: string;
  totalNgn: string;
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  instructions?: Record<string, unknown>;
}): string {
  const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => escapes[ch] || ch);
  const instructions = params.instructions || {};
  const bank = instructions.bank as { name?: string; accountName?: string; accountNumber?: string } | undefined;
  const pickup = instructions.pickup as { address?: string; hours?: string } | undefined;
  const fmt = (value: unknown) => value ? String(value).replace(/_/g, ' ') : '—';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${EMAIL_CSS}</style></head>
<body>
 <div class="container">
    <div class="header"><h1>${esc(params.label)} — Order ${esc(params.orderNo)}</h1></div>
    <div class="body">
      <p>Hi ${esc(params.customerName || 'there')},</p>
      <p>Here is the latest update on your order.</p>
      <table>
        <tr><td>Order #</td><td>${esc(params.orderNo)}</td></tr>
        <tr><td>Update</td><td>${esc(params.label)}</td></tr>
        <tr><td>Order Status</td><td>${esc(fmt(params.status))}</td></tr>
        <tr><td>Payment</td><td>${esc(fmt(params.paymentMethod))} — ${esc(fmt(params.paymentStatus))}</td></tr>
        <tr><td>Total</td><td>${esc(params.totalNgn)}</td></tr>
      </table>
      ${params.paymentMethod === 'bank_transfer' && params.paymentStatus !== 'paid' && bank
      ? `<p>To complete payment, transfer <strong>${esc(params.totalNgn)}</strong> to:<br>${esc(bank.name)} — ${esc(bank.accountName)}<br>Account: <strong>${esc(bank.accountNumber)}</strong><br>Use your order number <strong>${esc(params.orderNo)}</strong> as the payment reference.</p>`
      : ''}
      ${pickup ? `<p>Pickup: ${esc(pickup.address)}. Hours: ${esc(pickup.hours)}.</p>` : ''}
    </div>
    <div class="footer">Questions about this order? Contact the store and quote your order number.</div>
 </div>
</body>
</html>`;
}
