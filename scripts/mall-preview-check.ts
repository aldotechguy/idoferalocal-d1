/** Read-only remote checks. No deployment, checkout, stock or payment writes. */
import assert from 'node:assert/strict';
import { accessDenied, accessHeaders } from './access-probe.ts';

async function main() {
  const configured=process.env.MALL_PREVIEW_BASE_URL;
  if(!configured) throw new Error('Set MALL_PREVIEW_BASE_URL to the disposable preview origin. No requests were made.');
  const base=new URL(configured);
  if(base.protocol!=='https:' || base.username || base.password || base.pathname!=='/') throw new Error('Use an HTTPS origin without credentials/path.');
  for(const path of ['/','/mall','/api/mall/health','/api/mall/products?limit=1']) {
    // Page routes must advertise an HTML accept header: the Worker's SPA fallback
    // serves index.html only to requests that want HTML, which is what a browser
    // sends. A bare fetch() sends `accept: */*` and would wrongly 404 on /mall.
    const headers = { ...(path.startsWith('/api/') ? {} : { accept: 'text/html' }), ...accessHeaders() };
    const response=await fetch(new URL(path,base),{headers,signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,`${path} should respond with 200`);
    if(path.startsWith('/api/')) await response.json(); else assert.match(response.headers.get('content-type') || '',/text\/html/);
    console.log(`PASS ${path}`);
  }
  const missingPhone=await fetch(new URL('/api/mall/orders?phone=08000000000',base),{headers:accessHeaders(),signal:AbortSignal.timeout(15000)});
  assert.equal(missingPhone.status,400,'Phone-only tracking must be rejected');
  // Staff endpoints must refuse an ANONYMOUS caller: with Access in front that
  // is a 403 or a redirect to the team domain (edge), or a 401 (origin).
  const unauthorized=await fetch(new URL('/api/staff/mall-orders',base),{headers:accessHeaders(),redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert.ok(unauthorized.status===401 || accessDenied(unauthorized),
    `Staff endpoints must require authentication (got ${unauthorized.status} ${unauthorized.headers.get('location')||''})`);
  // Preview is intentionally cron-free and uses an isolated database with email
  // secrets unset, so production readiness (scheduler/webhook delivery) is not a
  // meaningful gate here. Verify preview isolation and non-mutating public APIs.
  const health = await fetch(new URL('/api/mall/health', base), { headers: accessHeaders(), signal: AbortSignal.timeout(15000) });
  const healthBody = await health.json() as { ok?: boolean; routes?: string[] };
  assert.equal(healthBody.ok, true);
  const config = await fetch(new URL('/api/mall/config', base), { headers: accessHeaders(), signal: AbortSignal.timeout(15000) });
  assert.equal(config.status, 200);
  const publicConfig = await config.json() as { checkoutEnabled?: boolean; pickup?: { address?: string } | null; bank?: { accountNumber?: string } | null };
  assert.equal(publicConfig.checkoutEnabled, false, 'Public Preview checkout must remain disabled.');
  assert.equal(publicConfig.pickup?.address, 'Preview pickup (disposable)');
  console.log('Read-only preview checks passed. Cron and webhook readiness are intentionally not asserted for disposable Preview.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Preview check failed');process.exitCode=1;});