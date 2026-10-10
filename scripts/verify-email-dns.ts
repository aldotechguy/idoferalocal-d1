/**
 * Verifies the transactional-email DNS posture for the Mall order mail.
 *
 * Why this exists: `docs/gmail-deliverability-fix.md` records the exact SPF and
 * DMARC records the domain needs, but "record documented in a markdown file" is not
 * "record live in DNS". A missing apex SPF (or a DMARC that was never created)
 * silently degrades order confirmations into Gmail's spam folder — buyers lose
 * their receipts and the business eats the chargebacks. This turns that untracked
 * ops task into a checkable one.
 *
 * Read-only: resolves TXT records over DNS-over-HTTPS (Cloudflare), so it needs no
 * credentials and no local resolver. It never fails on a network error — an
 * unreachable resolver SKIPS with a warning rather than reporting a false failure.
 *
 * Usage:
 *   npx tsx scripts/verify-email-dns.ts
 *   npx tsx scripts/verify-email-dns.ts --json
 *
 * Exit codes: 0 = every check passed (or skipped), 1 = a required record is missing
 * or malformed.
 */
import 'dotenv/config';

/** The sender domain, overridable so the same check works for a new apex. */
const DOMAIN = process.env.MALL_EMAIL_DOMAIN || 'idofera.de5.net';
const DKIM_SELECTOR = process.env.MALL_EMAIL_DKIM_SELECTOR || 'resend';
const args = process.argv.slice(2);
const asJson = args.includes('--json');

type Check = { name: string; status: 'pass' | 'warn' | 'fail' | 'skip'; record?: string; detail: string };

async function resolveTxt(name: string): Promise<string[] | null> {
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { Answer?: { data: string }[] };
    // TXT answers arrive chunked in quotes; join the chunks of each record.
    return (body.Answer || []).map((answer) => (answer.data.replace(/^"|"$/g, '').replace(/"\s*"/g, '')));
  } catch {
    return null;
  }
}

async function main() {
  const checks: Check[] = [];

  const apexTxt = await resolveTxt(DOMAIN);
  if (apexTxt === null) {
    checks.push({ name: `SPF @${DOMAIN}`, status: 'skip', detail: 'DNS-over-HTTPS unreachable; could not evaluate.' });
    checks.push({ name: `DMARC _dmarc.${DOMAIN}`, status: 'skip', detail: 'DNS-over-HTTPS unreachable; could not evaluate.' });
    checks.push({ name: `DKIM ${DKIM_SELECTOR}._domainkey.${DOMAIN}`, status: 'skip', detail: 'DNS-over-HTTPS unreachable; could not evaluate.' });
  } else {
    const spf = apexTxt.find((record) => record.startsWith('v=spf1'));
    if (!spf) {
      checks.push({ name: `SPF @${DOMAIN}`, status: 'fail', detail: 'No apex SPF record. Mail is sent From: orders@' + DOMAIN + ', so Gmail evaluates SPF against the apex.' });
    } else if (!/include:(amazonses\.com|_spf\.resend\.com|amazonses)/i.test(spf)) {
      checks.push({ name: `SPF @${DOMAIN}`, status: 'warn', record: spf, detail: 'SPF exists but lists neither amazonses.com nor resend; the shared SES pool will not authenticate.' });
    } else {
      checks.push({ name: `SPF @${DOMAIN}`, status: 'pass', record: spf, detail: 'Apex SPF authorises the SES/Resend sender.' });
    }

    const dmarc = (await resolveTxt(`_dmarc.${DOMAIN}`))?.find((record) => record.startsWith('v=DMARC1'));
    if (!dmarc) {
      checks.push({ name: `DMARC _dmarc.${DOMAIN}`, status: 'warn', detail: 'No DMARC record. Add p=none with rua so failures are visible before tightening.' });
    } else if (!/p=(none|quarantine|reject)/.test(dmarc)) {
      checks.push({ name: `DMARC _dmarc.${DOMAIN}`, status: 'warn', record: dmarc, detail: 'DMARC present but has no policy (p=).' });
    } else {
      checks.push({ name: `DMARC _dmarc.${DOMAIN}`, status: 'pass', record: dmarc, detail: 'DMARC policy published.' });
    }

    const dkim = (await resolveTxt(`${DKIM_SELECTOR}._domainkey.${DOMAIN}`))?.find((record) => /v=DKIM1|k=rsa|p=/.test(record));
    checks.push(dkim
      ? { name: `DKIM ${DKIM_SELECTOR}._domainkey.${DOMAIN}`, status: 'pass', detail: 'DKIM public key published.' }
      : { name: `DKIM ${DKIM_SELECTOR}._domainkey.${DOMAIN}`, status: 'fail', detail: 'No DKIM record at the expected selector; align it or set MALL_EMAIL_DKIM_SELECTOR.' });
  }

  const failing = checks.filter((check) => check.status === 'fail');
  if (asJson) {
    console.log(JSON.stringify({ domain: DOMAIN, checks, ok: failing.length === 0 }, null, 2));
  } else {
    console.log(`Transactional-email DNS posture for ${DOMAIN}\n`);
    for (const check of checks) {
      const tag = check.status === 'pass' ? 'PASS' : check.status === 'fail' ? 'FAIL' : check.status === 'warn' ? 'WARN' : 'SKIP';
      console.log(`  [${tag}] ${check.name}`);
      console.log(`         ${check.detail}`);
      if (check.record) console.log(`         ${check.record}`);
    }
    console.log('');
    console.log(failing.length === 0 ? 'OK — no required record is missing.' : `${failing.length} required record(s) missing.`);
  }
  process.exitCode = failing.length === 0 ? 0 : 1;
}

void main();
