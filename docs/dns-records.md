# apex DNS records for idofera.de5.net (Cloudflare, DNS-only / grey cloud)

Transactional Mall mail is sent `From: orders@idofera.de5.net` via Resend (shared
Amazon SES pool). Gmail evaluates SPF against the **apex**, so the apex — not just
`send.idofera.de5.net` — must authorise the sender.

Verify the live posture at any time with:

    npm run verify:email-dns

That check queries DNS-over-HTTPS; at the time of writing it reports the apex SPF
record **missing** (DMARC and DKIM already pass). Apply the record below to fix it.

## Required records

| Type | Name  | Content                                                          | Status  |
| ---- | ----- | ---------------------------------------------------------------- | ------- |
| TXT  | `@`   | `v=spf1 include:amazonses.com ~all`                              | MISSING |
| TXT  | `_dmarc` | `v=DMARC1; p=none; rua=mailto:idoferapackaging@gmail.com; aspf=s; adkim=s;` | present as `p=none;` |

Notes:

- **One SPF record per name.** If an SPF TXT record already exists at `@`, merge the
  `include:` terms into it — two `v=spf1` records at the same name is a permanent
  SPF failure.
- Keep the `~all` softfail while reputation is low; move to `-all` (hardfail) only
  after `npm run verify:email-dns` and Resend delivery events stay clean for weeks.
- `aspf=s; adkim=s` (strict alignment) is safe because the `From:` domain and the
  DKIM `d=` domain are both `idofera.de5.net`.
- Leave both records **DNS only** (grey cloud). Proxying TXT records breaks them.

## Escalation path (from docs/gmail-deliverability-fix.md)

1. Apply the apex SPF record and re-run `npm run verify:email-dns` → expect all PASS.
2. Send one real order confirmation to a controlled Gmail inbox; check Resend →
   Emails for `delivered` vs `bounced`/`complained`.
3. Only after clean delivery for weeks, tighten DMARC `p=none` → `p=quarantine`.
