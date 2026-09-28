import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { isPrivateApi, isStaffPage } from '../src/server/staffEntrance.ts';
import {
  STAFF_ACCESS_EXEMPT_PATHS,
  STAFF_ACCESS_PATHS,
  isAccessProtectedPath,
  matchesAccessPattern,
} from '../src/server/staffAccess.ts';

/**
 * The Cloudflare Access applications are configured by hand in the dashboard,
 * so this suite is what keeps that configuration honest: every path the server
 * treats as staff-only or private must be covered by the documented pattern
 * list, and every path a shopper needs must stay uncovered.
 */

test('every staff page and private API is covered by an Access pattern', () => {
  const staffAndPrivate = [
    '/labs', '/labs/pos', '/labs/mall-orders', '/app', '/app/pos',
    '/api/storage/snapshot', '/api/storage/records', '/api/storage/d1/health',
    '/api/ai/business-assistant', '/api/ai/pricing-assistant', '/api/ai/sales-forecasting',
    '/api/staff/mall-orders', '/api/staff/mall-orders/counts', '/api/staff/mall-listings', '/api/staff/product-images',
    '/api/auth/users', '/api/auth/users/usr-admin-1', '/api/auth/password',
    '/api/auth/session',
  ];
  for (const path of staffAndPrivate) {
    assert.ok(isStaffPage(path) || isPrivateApi(path) || path === '/api/auth/session', `${path} is expected to be a staff/private path`);
    assert.equal(isAccessProtectedPath(path), true, `${path} must be listed in STAFF_ACCESS_PATHS`);
  }
});

test('the storefront and the sign-in flow stay reachable without Access', () => {
  const publicPaths = [
    '/', '/category/packaging', '/product/prod-1', '/search', '/checkout', '/orders', '/order-success',
    '/assets/index-abc.js', '/mall-images/prod-1.jpg',
    '/api/health', '/api/mall', '/api/mall/products', '/api/mall/cart', '/api/mall/orders', '/api/mall/ready', '/api/mall-webhook',
    '/api/auth/entrance', '/api/auth/login', '/api/auth/google', '/api/auth/logout',
  ];
  for (const path of publicPaths) {
    assert.equal(isPrivateApi(path), false, `${path} must not be treated as a private API`);
    assert.equal(isAccessProtectedPath(path), false, `${path} must never be covered by an Access application`);
  }
  for (const exempt of STAFF_ACCESS_EXEMPT_PATHS) {
    assert.equal(isAccessProtectedPath(exempt), false, `${exempt} is exempt from Access by design`);
  }
});

test('the Access pattern list only uses supported wildcard shapes', () => {
  for (const pattern of STAFF_ACCESS_PATHS) {
    assert.match(pattern, /^\//, `${pattern} must be an absolute path`);
    assert.ok(!/\/[^/]*\*[^/]*\*/.test(pattern), `${pattern} may contain at most one wildcard per path segment`);
    assert.ok(!pattern.includes('?') && !pattern.includes('#'), `${pattern} must not contain a query string or fragment`);
  }
});

test('a pattern matches its own path family and nothing else', () => {
  assert.equal(matchesAccessPattern('/labs*', '/labs'), true);
  assert.equal(matchesAccessPattern('/labs*', '/labs/pos'), true);
  assert.equal(matchesAccessPattern('/labs*', '/labs-o-rama'), true);
  assert.equal(matchesAccessPattern('/labs*', '/app'), false);
  assert.equal(matchesAccessPattern('/api/auth/session', '/api/auth/session'), true);
  assert.equal(matchesAccessPattern('/api/auth/session', '/api/auth/session-extra'), false);
  assert.equal(matchesAccessPattern('/api/auth/password', '/api/auth/passwords'), false);
});

test('the docs and the dashboard checklist name the same paths', () => {
  const docs = fs.readFileSync('docs/staff-access.md', 'utf8');
  for (const pattern of STAFF_ACCESS_PATHS) {
    assert.ok(docs.includes(`\`${pattern}\``), `docs/staff-access.md must list ${pattern}`);
  }
  for (const exempt of STAFF_ACCESS_EXEMPT_PATHS) {
    assert.ok(docs.includes(`\`${exempt}\``), `docs/staff-access.md must list the exemption ${exempt}`);
  }
});

/**
 * The outage this locks: every environment that Access fronts must ALSO be able
 * to verify the token Access mints. `idomall-preview` was fronted by Access while
 * its deployment ran with `CF_ACCESS_SSO = "false"` and an empty `CF_ACCESS_AUD`,
 * so /api/auth/session could never mint a session and a completed OTP silently
 * bounced the browser back to the Mall. A host behind Access with the gate
 * switched off is never a valid configuration.
 */
test('every Access-fronted environment enables the gate and carries the audience tags', () => {
  const toml = fs.readFileSync('wrangler.toml', 'utf8');
  // The per-environment blocks: [env.mall.vars] and [env.preview.vars].
  const sections = new Map<string, string>();
  let current = '';
  for (const line of toml.split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      if (!sections.has(current)) sections.set(current, '');
      continue;
    }
    if (current && sections.has(current)) sections.set(current, `${sections.get(current)}\n${line}`);
  }

  const value = (section: string, key: string) => {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(sections.get(section) || '');
    return match ? match[1] : '';
  };

  // Both deployed environments sit behind Access applications.
  for (const section of ['env.mall.vars', 'env.preview.vars']) {
    assert.ok(sections.has(section), `wrangler.toml must define [${section}]`);
    assert.equal(value(section, 'CF_ACCESS_SSO'), 'true', `[${section}] must enable the SSO gate`);
    assert.match(value(section, 'CF_ACCESS_TEAM_DOMAIN'), /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/, `[${section}] must configure the team domain`);
    const tags = value(section, 'CF_ACCESS_AUD').split(',').map((tag) => tag.trim()).filter(Boolean);
    // Access mints one tag per application, and the hosts covered differ per
    // environment, so a single tag always means at least one host will reject.
    assert.ok(tags.length >= 2, `[${section}] must list every Access application audience, got ${tags.length}`);
    for (const tag of tags) {
      assert.match(tag, /^[0-9a-f]{64}$|^[0-9a-f-]{36}$/, `[${section}] has a malformed audience tag: ${tag}`);
    }
  }
});

