# Resend domain verification for idofera.de5.net — CONFIRMED
Zone host: **Cloudflare** (`mario.ns.cloudflare.com`, `romina.ns.cloudflare.com`).

## Verified Resend identities (both live, region eu-west-1 / Ireland)

| Identity | Status |
| --- | --- |
| **`idofera.de5.net`** (apex) | ✅ verified — **the sender in use** |
| `orders.idofera.de5.net` (subdomain) | ✅ verified |

### Apex records (published and verified)

| Record | Name | Value |
| --- | --- | --- |
| DKIM (TXT) | `resend._domainkey.idofera` | `p=MIGfMA0GCSq…G5a7wIDAQAB` |
| Return-path (CNAME) | `rsend.idofera` | `rsend-euw1.forge.rmta.net` |
| Send (CNAME) | `send.idofera` | `send.forge.rmta.net` |
| Inbound (MX) | `idofera` | `inbound-smtp.eu-west-1.amazonaws.com` (priority 10) |

### Subdomain records (published and verified)

| Record | Name | Value |
| --- | --- | --- |
| DKIM (TXT) | `resend._domainkey.orders.idofera` | `p=MIGfMA0GCSq…SdwIDAQAB` |
| Return-path (CNAME) | `rsend.orders.idofera` | `rsend-euw1.forge.rmta.net` |
| Send (CNAME) | `send.orders.idofera` | `send.forge.rmta.net` |
| Inbound (MX) | `orders.idofera` | `inbound-smtp.eu-west-1.amazonaws.com` (priority 10) |
| Links (CNAME) | `mall.orders.idofera` | `links2.resend-dns.com` |

Both are verified. No DNS changes are needed.

## Sender address in use
```dotenv
MALL_EMAIL_FROM="Idofera <orders@idofera.de5.net>"
```

## History: the original bug
`MALL_EMAIL_FROM` once pointed at the apex while only the **subdomain** was verified:

- `orders@idofera.de5.net` → `403 The idofera.de5.net domain is not verified`
- `mall@orders.idofera.de5.net` → sent OK (verified subdomain)

Adding the apex as its own Resend domain and publishing the records above resolved it.

## Note — DKIM cleanup done
`resend._domainkey.idofera.de5.net` originally returned **two** DKIM TXT values (the apex
key and the old subdomain key). The stale subdomain value has been **removed**; the name
now returns the single apex key (`p=…G5a7wIDAQAB`). Confirmed by public DNS lookup, and a
fresh end-to-end send still delivers both copies.
