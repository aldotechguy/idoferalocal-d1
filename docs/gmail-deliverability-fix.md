# Gmail deliverability — 550-5.7.1 unsolicited mail

## The error
```
smtp; 550-5.7.1 Gmail has detected that this message is likely unsolicited mail...
5.7.1 https://support.google.com/mail/?p=UnsolicitedMessageError
```

This is a **reputation/content** block, not an authentication failure. If SPF or
DKIM were failing the error would be `5.7.26 ... unauthenticated` instead. So
DKIM/SPF/DMARC are passing; Gmail is classifying the *message and sending pattern*
as spam-like.

## Root causes identified (in order of impact)

1. **Bursty sending from a zero-history domain.** The cron drained a backlog and
   sent **20 near-identical emails within two minutes** (10 at 02:20, 10 at 02:25).
   A brand-new domain that suddenly emits a burst of similar mail is the textbook
   trigger for `UnsolicitedMessageError`. This dominates the other factors.
2. **HTML-only messages.** No `text/plain` alternative is a negative content signal
   for a low-reputation sender. **FIXED in code** — every send now includes a
   derived plain-text part (`textFromHtml`).
3. **No Reply-To.** Mail from a young domain with no reply path looks bulk.
   **FIXED in code** — `Reply-To` now defaults to the operator inbox
   (`MALL_EMAIL_REPLY_TO`, falling back to `MALL_NOTIFY_EMAIL`).
4. **No List-Unsubscribe headers.** Expected from senders; a one-click opt-out
   converts a complaint into a harmless unsubscribe. **FIXED in code** — both
   `List-Unsubscribe` (mailto) and `List-Unsubscribe-Post: One-Click` are set.
5. **Weak DNS posture.** DMARC is `p=none` and the **apex has no SPF record**
   (`send.idofera.de5.net` has SPF but it does not list the SES sending IPs used
   by Resend). DKIM passes, so this is secondary, but tightening it helps.

## DNS recommendations (do these in Cloudflare, DNS only / grey cloud)

### 1. Add a root SPF record for `idofera.de5.net`
| Type | Name | Content |
| --- | --- | --- |
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |

The apex currently has **no** SPF TXT record at all. Because mail is sent
`From: orders@idofera.de5.net`, Gmail evaluates SPF against the apex.

### 2. Strengthen DMARC once mail is flowing cleanly
| Type | Name | Content |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:idoferapackaging@gmail.com; aspf=s; adkim=s;` |

Start at `p=none` while reputation is low; move to `p=quarantine` only after
weeks of clean delivery. `rua` gives aggregate reports so you can see failures.

## Operational guidance (this is what actually clears the block)

1. **Stop bursts.** Do not reset the outbox and drain a backlog to Gmail again —
   that re-creates the exact pattern that caused the block. Send to real buyers
   only, naturally paced.
2. **Warm up.** For the first days send a small, steady volume; Gmail grants
   reputation gradually. Resend delivers via a shared IP pool
   (`54.240.3.23` = `a3-23.smtp-out.eu-west-1.amazonses.com`), so your own
   reputation is limited until you have volume.
3. **Ask recipients to mark as "Not spam."** A few positive actions from real
   inboxes flip the classification quickly for a small sender.
4. **Consider a Resend dedicated IP** once volume justifies it, so your sending
   reputation is not shared.
5. **Verify with a seed test.** Send one real order confirmation to a Gmail
   address you control, then check the **Resend → Emails** log for the delivery
   event: `delivered` vs `bounced`/`complained`.

## What was changed in code (this commit)

`src/server/mallWebhook.ts`:
- `sendEmail` now sends `text`, `reply_to`, and the two `List-Unsubscribe` headers.
- Added `textFromHtml()` to derive the plain-text part from the existing HTML.
- Added `MALL_EMAIL_REPLY_TO` to `WebhookEnv` (optional; falls back to the operator).

`scripts/mall-safety.test.ts`:
- The email test now asserts every send carries a tag-free `text` part, a
  `Reply-To`, and both unsubscribe headers, on the operator and customer copies.
