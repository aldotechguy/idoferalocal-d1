import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { catalogStatus, productStockLabel } from '../src/shared/productStatus.ts';
import { productToRow } from '../src/server/relationalMapper.ts';
import { parseRoute } from '../src/hooks/useRoute.ts';
import { computeMenuStyle, PORTAL_DROPDOWN_Z } from '../src/components/common/PortalDropdown.tsx';
import { validateBuyer } from '../src/mall-site/useBuyerForm.ts';
import { mallDeliveryFeeKobo, mallDeliveryZone } from '../src/shared/mallDelivery.ts';
import { localIsoDate } from '../src/shared/localDate.ts';
import { mallAvailabilityLabel, mallStockLabel } from '../src/shared/mallProductPresentation.ts';
import { mallReadinessSummary } from '../src/shared/mallReadinessPresentation.ts';
import { mallClient } from '../src/services/mallClient.ts';
import { createMallSearchMatcher, mallOneTypo } from '../src/shared/mallSearch.ts';
import { handleMallApi } from '../src/server/mallApi.ts';
import worker from '../sites-worker.ts';
import { createStaffCartHold, STAFF_CART_HOLD_MS } from '../src/hooks/useStaffCartHold.ts';
import { DatabaseSync } from 'node:sqlite';
import { issueEntrance, hasEntrance, revokeEntrance, entranceCookie, isStaffPage, isPrivateApi } from '../src/server/staffEntrance.ts';
import { issueStepUp, hasStepUp, STEP_UP_COOKIE } from '../src/server/stepUp.ts';
import { ensureRelationalSchemaNode } from '../src/server/nodeAdapter.ts';

function entranceFixture() {
  const db = new DatabaseSync(':memory:');
  const query = async (sql: string, params: any[]) => db.prepare(sql).all(...params);
  const DB = { prepare: (sql: string) => ({ bind: (...params: any[]) => ({ all: async () => ({ results: await query(sql, params) }) }) }) };
  return { db, query, DB };
}

test('Explore requests stock-first ordering without a per-row cap', () => {
  const home = fs.readFileSync('src/mall-site/MallHome.tsx', 'utf8');
  assert.match(home, /fetchFn=\{fetchSearch\(''\)\} stockFirst/);
  const grid = fs.readFileSync('src/mall-site/MallBrowseGrid.tsx', 'utf8');
  assert.doesNotMatch(grid, /maxSoldOutPerRow|arrangeStockRows/);
  assert.match(grid, /stockFirst: 1 as const/);
});

test('catalog visibility is independent of stock and archive survives normalization', () => {
  for (const status of ['Active', 'Low Stock', 'Out of Stock', undefined]) {
    assert.equal(catalogStatus(status), 'Active');
  }
  assert.equal(catalogStatus('Archived'), 'Archived');
  for (const status of ['Low Stock', 'Out of Stock', 'Archived']) {
    const row = productToRow({ id: 'test-product', status, currentStock: 0 }, '2026-09-19T00:00:00Z');
    assert.equal(row.status, status === 'Archived' ? 'Archived' : 'Active');
    assert.equal(row.stock_qty, 0);
  }
  assert.equal(productStockLabel({ status: 'Active', currentStock: 0, minimumStockLevel: 5 }), 'Out of Stock');
  assert.equal(productStockLabel({ status: 'Active', currentStock: 3, minimumStockLevel: 5 }), 'Low Stock');
  assert.equal(productStockLabel({ status: 'Low Stock', currentStock: 30, minimumStockLevel: 5 }), 'Active');
  assert.equal(productStockLabel({ status: 'Archived', currentStock: 0, minimumStockLevel: 5 }), 'Archived');
});

test('visibility migration preserves quantities and archives and is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE products (id TEXT, status TEXT, stock_qty INTEGER);");
    for (const status of ['Active', 'Low Stock', 'Out of Stock', 'Archived']) {
      db.prepare('INSERT INTO products VALUES (?, ?, ?)').run(status, status, 0);
    }
    const sql = fs.readFileSync('scripts/migrations/normalize-product-visibility.sql', 'utf8');
    db.exec(sql);
    db.exec(sql);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products WHERE status = 'Active'").get()?.n, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products WHERE status = 'Archived'").get()?.n, 1);
    assert.equal(db.prepare('SELECT SUM(stock_qty) AS n FROM products').get()?.n, 0);
  } finally { db.close(); }
});

test('sync checks relational success before clearing pending changes', () => {
  const source = fs.readFileSync('src/services/d1StorageService.ts', 'utf8');
  const sync = source.slice(source.indexOf('export async function syncLocalRecordsToD1'));
  assert.ok(sync.indexOf('result.relationalSynced === false') < sync.indexOf('localStorage.setItem(REVISION_KEY'));
  assert.match(sync, /Pending changes have been retained/);
});

test('staff snapshot startup waits for authentication and cached profiles cannot restore sessions', () => {
  const app = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
  assert.match(app, /if \(authLoading \|\| !currentUser \|\| !isStorageReady\) return;/);
  assert.equal((app.match(/initializeD1Storage\(currentD1Snapshot\(\)\)/g) || []).length, 1);
  assert.match(app, /\[authLoading, currentUser, isStorageReady, applyCloudData\]/);
  assert.match(app, /if \(authLoading \|\| !currentUser \|\| !isD1Ready/);
  const auth = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
  assert.doesNotMatch(auth, /if \(found\) setCurrentUser\(found\)/);
});

test('sign-in endpoints are reachable from a cold browser and never gated behind the staff entrance', async () => {
  // The staff entrance is a second factor that is only ISSUED after a successful
  // sign-in, so requiring it in order to sign in is circular. The gate expression
  // had this inverted, and every signed-out POST /api/auth/login was answered 401
  // STAFF_ENTRANCE_REQUIRED without the credentials ever being checked.
  for (const path of ['/api/auth/login', '/api/auth/google']) {
    const response = await worker.fetch(new Request(`https://test${path}`, { method: 'POST' }), {} as Parameters<typeof worker.fetch>[1]);
    // With no entrance cookie and no DB, login must fail for AUTH reasons (500
    // from the missing binding in this fixture) — never with the entrance code.
    assert.notEqual(response.status, 302);
    const body = await response.clone().json().catch(() => ({})) as { code?: string };
    assert.notEqual(body.code, 'STAFF_ENTRANCE_REQUIRED');
  }
  // The same endpoints must not answer the entrance error in the Node runtime.
  const node = fs.readFileSync('server.ts', 'utf8');
  assert.match(node, /let entrance = login \? true : await hasEntrance\(cookie, entranceQuery\);/);
  const workerSource = fs.readFileSync('sites-worker.ts', 'utf8');
  assert.match(workerSource, /let entrance = login \? true : await hasEntrance\(cookie, query\);/);
  // Staff pages additionally accept a verified Access JWT, so an OTP login
  // lands on the workspace without an entrance cookie or a session yet.
  assert.match(node, /if \(!entrance && staffPage && process\.env\.CF_ACCESS_SSO === 'true'\) \{\r?\n\s*entrance = \(await accessIdentityFor\(req\)\) !== null;/);
  assert.match(workerSource, /if \(!entrance && staffPage && env\.CF_ACCESS_SSO === 'true'\) \{\r?\n\s*entrance = \(await accessIdentityFor\(request, env\)\) !== null;/);
});

test('worker serves deep-link HTML without forwarding the index.html redirect', async t => {
  const fixture = entranceFixture();
  t.after(() => fixture.db.close());
  const cookie = entranceCookie(await issueEntrance(fixture.query)).split(';')[0];
  for (const path of ['/labs', '/labs/dashboard', '/app/pos', '/checkout']) {
    const requested: string[] = [];
    const env = {
      DB: fixture.DB,
      ASSETS: {
        async fetch(request: Request) {
          const pathname = new URL(request.url).pathname;
          requested.push(pathname);
          if (pathname === '/index.html') return Response.redirect('https://test/', 307);
          if (pathname === '/') return new Response('<html>__SITE_ORIGIN__</html>', {
            headers: { 'content-type': 'text/html', 'content-length': '33' },
          });
          return new Response(null, { status: 404 });
        },
      },
    };
    const response = await worker.fetch(new Request(`https://test${path}`, {
      headers: { accept: 'text/html', cookie },
    }), env as Parameters<typeof worker.fetch>[1]);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), isStaffPage(path) ? 'no-store' : 'no-cache, max-age=0');
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(await response.text(), '<html>https://test</html>');
    assert.deepEqual(requested, [path, '/']);
  }
});

test('worker does not turn missing scripts or API routes into the app shell', async () => {
  const requested: string[] = [];
  const env = {
    ASSETS: {
      async fetch(request: Request) {
        requested.push(new URL(request.url).pathname);
        return new Response(null, { status: 404 });
      },
    },
  };
  for (const path of ['/assets/missing.js', '/api/missing']) {
    const response = await worker.fetch(new Request(`https://test${path}`), env as Parameters<typeof worker.fetch>[1]);
    assert.equal(response.status, path.startsWith('/api/') ? 401 : 404);
  }
  assert.deepEqual(requested, ['/assets/missing.js']);
});

test('staff entrance expires, can be revoked, and never authorizes private APIs', async t => {
  const f = entranceFixture();
  t.after(() => f.db.close());
  const env = { DB: f.DB, ASSETS: { fetch: async () => new Response('shell', { headers: { 'content-type': 'text/html' } }) } } as unknown as Parameters<typeof worker.fetch>[1];
  for (const path of ['/labs', '/labs/pos', '/app', '/app/reports']) {
    const response = await worker.fetch(new Request(`https://test${path}`), env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const rejected = await worker.fetch(new Request('https://test/api/auth/entrance', { method: 'POST' }), env);
  assert.equal(rejected.status, 403);
  const entrance = await worker.fetch(new Request('https://test/api/auth/entrance', {
    method: 'POST', headers: { origin: 'https://test', 'x-staff-entrance': 'cart-hold' },
  }), env);
  assert.equal(entrance.status, 200);
  const cookie = entrance.headers.get('set-cookie')!.split(';')[0];
  assert.match(entrance.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict; Max-Age=300; Secure/);
  assert.equal(await hasEntrance(cookie, f.query), true);
  assert.equal((await worker.fetch(new Request('https://test/labs', { headers: { cookie } }), env)).status, 200);
  // The entrance cookie is a SECOND factor for the staff pages only. It must not
  // widen access to a private API just by being present: the handler still finds
  // no app session and refuses. With a real session it must succeed, so this
  // asserts refusal rather than a specific status — the point is that presenting
  // an entrance cookie alone never returns a success.
  for (const path of ['/api/storage/snapshot', '/api/storage/records', '/api/ai/business-assistant', '/api/staff/mall-orders']) {
    const guarded = await worker.fetch(new Request(`https://test${path}`, { headers: { cookie } }), env);
    assert.ok(guarded.status >= 400, `${path} answered ${guarded.status} with only an entrance cookie`);
  }
  await revokeEntrance(cookie, f.query);
  assert.equal(await hasEntrance(cookie, f.query), false);
  const expired = entranceCookie(await issueEntrance(f.query));
  f.db.exec('UPDATE staff_entrances SET expires_at = 0');
  assert.equal(await hasEntrance(expired, f.query), false);
  assert.equal((await worker.fetch(new Request('https://test/labs', { headers: { cookie: expired } }), env)).status, 302);
  assert.equal(isPrivateApi('/api/mall/products'), false);
  assert.equal(isPrivateApi('/api/storage/d1/health'), true);
});

test('signed-in staff can open direct links; logout revokes session and entrance', async t => {
  const f = entranceFixture();
  t.after(() => f.db.close());
  f.db.exec(`CREATE TABLE app_users (id TEXT, status TEXT);
    CREATE TABLE app_sessions (token_hash TEXT, user_id TEXT, created_at INTEGER, expires_at INTEGER, last_seen_at INTEGER);
    INSERT INTO app_users VALUES ('staff', 'Active');`);
  const token = 'test-session';
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  f.db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?, ?, ?)').run(hash, 'staff', now, now + 60000, now);
  const DB = {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        all: async () => ({ results: await f.query(sql, params) }),
        run: async () => f.db.prepare(sql).run(...params),
      })
    })
  };
  const env = { DB, ASSETS: { fetch: async () => new Response('staff shell', { headers: { 'content-type': 'text/html' } }) } } as unknown as Parameters<typeof worker.fetch>[1];
  const entrance = entranceCookie(await issueEntrance(f.query)).split(';')[0];
  const cookie = `idofera_session=${token}; ${entrance}`;
  assert.equal((await worker.fetch(new Request('https://test/labs/reports', { headers: { cookie: `idofera_session=${token}` } }), env)).status, 200);
  const logout = await worker.fetch(new Request('https://test/api/auth/logout', { method: 'POST', headers: { cookie } }), env);
  assert.equal(logout.status, 200);
  assert.equal(await hasEntrance(entrance, f.query), false);
  assert.equal((await worker.fetch(new Request('https://test/labs/reports', { headers: { cookie } }), env)).status, 302);
});

test('Mall merchandising explains Active visibility without publishing controls', () => {
  const editor = fs.readFileSync(new URL('../src/components/products/MallListingsView.tsx', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/services/staffMallListingClient.ts', import.meta.url), 'utf8');
  assert.match(editor, /All Active products appear automatically/);
  assert.doesNotMatch(editor, /draft\.publish|Publish on|Not published|canPublish/);
  assert.doesNotMatch(client, /publish: boolean|blockPublish|canPublish/);
  assert.match(editor, /Mall price/);
  assert.match(editor, /Optional promotion/);
  assert.match(editor, /POS promotional price/);
  assert.match(editor, /MALL_HONOR_POS_PROMOS/);
});

test('forgiving search handles spacing, word order and conservative typos', () => {
  const product = { name: 'Spray Bottle 500 ml', category_name: 'Packaging', brand: 'Acme' };
  for (const query of ['spraybottle', 'spray   bottle', 'bot tle', 'bottle spray', '500ml bottle', 'spray-bottle']) {
    assert.ok(createMallSearchMatcher(query)(product) >= 60, query);
  }
  for (const query of ['botle', 'bottel', 'spray botle']) assert.equal(createMallSearchMatcher(query)(product), 30, query);
  for (const query of ['5000ml bottle', '50ml bottle', 'spray bot', 'botle unrelated', '%%']) {
    if (query === 'spray bot') assert.ok(createMallSearchMatcher(query)(product) >= 60);
    else assert.equal(createMallSearchMatcher(query)(product), 0, query);
  }
  assert.equal(mallOneTypo('cat', 'cap'), false);
  assert.equal(mallOneTypo('5000', '5001'), false);
  assert.equal(createMallSearchMatcher('bottel')({ name: 'Box', description: 'Bottle' }), 0);
  assert.ok(createMallSearchMatcher('bottle')({ name: 'Bottle' }) > createMallSearchMatcher('bottle')(product));
});

test('forgiving matching benchmark over 10000 catalog documents', () => {
  const match = createMallSearchMatcher('spray bottel');
  const start = performance.now();
  let found = 0;
  for (let i = 0; i < 10000; i++) if (match({ name: `Spray Bottle ${i} ml`, brand: 'Acme', category_name: 'Packaging' })) found++;
  assert.equal(found, 10000);
  console.info(`Search matching: 10000 documents in ${Math.round(performance.now() - start)}ms (local, excludes database/network).`);
});

test('mall catalog requests forward cancellation and encode live-search text', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let requested = '';
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (url, options) => {
    requested = String(url);
    signal = options?.signal;
    return new Response(JSON.stringify({ products: [], total: 0, categories: [] }));
  };
  try {
    await mallClient.products({ q: 'bottles & jars', limit: 6 }, { signal: controller.signal });
    const url = new URL(requested, 'http://test');
    assert.equal(url.pathname, '/api/mall/products');
    assert.equal(url.searchParams.get('q'), 'bottles & jars');
    assert.equal(url.searchParams.get('limit'), '6');
    assert.equal(signal, controller.signal);
  } finally { globalThis.fetch = original; }
});

test('storefront read routes are cacheable but every money or session route is not', async () => {
  const emptyExec: any = { queryAll: async () => [], runBatch: async () => [1] };
  // Product detail needs a row, or the route 404s and a 404 is (correctly)
  // never cached -- which would make a naive "is it public?" assertion lie.
  const stockedExec: any = {
    queryAll: async () => ([{ id: 'prod-1', name: 'Test', stock_qty: 5, price_kobo: 1500, status: 'Active' }]),
    runBatch: async () => [1],
  };
  const cacheControlFor = async (path: string, exec: any = emptyExec, init: RequestInit = {}) => {
    const response = await handleMallApi(new Request(`http://test${path}`, init), exec);
    return { status: response.status, cacheControl: response.headers.get('cache-control') || '' };
  };

  // Public reads carry no session, no PII and no money.
  const list = await cacheControlFor('/api/mall/products?limit=10');
  assert.equal(list.status, 200);
  assert.match(list.cacheControl, /public, max-age=30, stale-while-revalidate=300/);
  const detail = await cacheControlFor('/api/mall/products/prod-1', stockedExec);
  assert.equal(detail.status, 200);
  assert.match(detail.cacheControl, /public, max-age=30/);

  // Session-scoped and money-bearing reads must never be cached.
  for (const path of ['/api/mall/home', '/api/mall/cart', '/api/mall/cart/total', '/api/mall/config', '/api/mall/orders']) {
    assert.equal((await cacheControlFor(path)).cacheControl, 'no-store', `${path} must not be cached`);
  }
  // A 404 must never be cached either, or a shopper would be pinned to it.
  assert.equal((await cacheControlFor('/api/mall/products/missing')).cacheControl, 'no-store');
  // A mutation is never cacheable, even on a read route shape.
  const posted = await cacheControlFor('/api/mall/products?limit=10', emptyExec, { method: 'POST' });
  assert.equal(posted.cacheControl, 'no-store', 'a POST must never be cached');
});

test('the service worker is registered for BOTH surfaces, not just the staff app', () => {
  const bootstrap = fs.readFileSync('src/bootstrap.ts', 'utf8');
  const pwaHook = fs.readFileSync('src/hooks/usePWAInstall.ts', 'utf8');
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const sw = fs.readFileSync('public/sw.js', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');

  // Registration must live in bootstrap (runs for every surface, before React).
  assert.match(bootstrap, /serviceWorker\.register\(['"]\/sw\.js/);
  // ...and must NOT still be duplicated in the staff-only hook, or the two
  // registrations race and the hook's copy re-registers after bootstrap's.
  assert.doesNotMatch(pwaHook, /serviceWorker\s*\n?\s*\.register/);
  // The hook only reports, it does not own registration.
  assert.match(pwaHook, /serviceWorker\.controller/);

  // The new worker must PARK, not take over a live page: unconditional
  // skipWaiting() on install re-introduces the version-skew hazard that the
  // network-first rule for executable assets exists to prevent.
  const installBlock = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  assert.doesNotMatch(installBlock, /skipWaiting\(\)/);
  assert.match(sw, /addEventListener\('message'/);
  assert.match(sw, /SKIP_WAITING/);

  // A real app shell means the hashed entry assets, not just the HTML.
  assert.match(sw, /precache-manifest\.json/);
  assert.ok(fs.existsSync('scripts/generate-precache-manifest.ts'), 'precache manifest generator must exist');
  assert.match(bootstrap, /storage\.persist\(\)/);

  // The purge constant in index.html must track CACHE_NAME in the worker. When
  // these drift, the inline script deletes the live cache on EVERY page load.
  const cacheName = /const CACHE_NAME = '([^']+)'/.exec(sw)?.[1];
  const currentCache = /const CURRENT_CACHE = '([^']+)'/.exec(html)?.[1];
  assert.ok(cacheName, 'sw.js must declare CACHE_NAME');
  assert.equal(currentCache, cacheName, 'index.html CURRENT_CACHE must match sw.js CACHE_NAME');
});

test('the service worker owns catalog caching and the storefront keeps its own branding', () => {
  const sw = fs.readFileSync('public/sw.js', 'utf8');
  const client = fs.readFileSync('src/services/mallClient.ts', 'utf8');
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');

  // The worker caches the public catalog and says so, rather than the app
  // re-implementing a cache and guessing whether it was live.
  assert.match(sw, /X-From-Cache/);
  assert.match(sw, /DATA_CACHE/);
  assert.match(client, /headers\.get\('X-From-Cache'\)/);
  // Session-scoped reads must stay app-level: /home carries this session's Buy
  // Again history, so a URL-keyed worker cache would leak it across sessions.
  assert.doesNotMatch(sw, /\/api\/mall\/home.*respondWith/);
  assert.match(client, /readThrough/);
  // The dead type is gone.
  assert.doesNotMatch(client, /type CachedMap/);

  // Cross-origin product photos arrive opaque; requiring type==='basic' meant no
  // image was ever cached, so offline browsing showed no photos.
  assert.match(sw, /destination === 'image'/);
  assert.match(sw, /type === 'opaque'/);

  // Two manifests: a customer must not install the app as "Idofera POS".
  const mall = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const staff = JSON.parse(fs.readFileSync('public/manifest-staff.json', 'utf8'));
  assert.equal(mall.short_name, 'IdoferaMall');
  assert.equal(staff.short_name, 'Idofera POS');
  assert.equal(mall.start_url, '/');
  assert.equal(staff.start_url, '/labs/dashboard');
  assert.ok(mall.icons.some((i: { purpose?: string }) => i.purpose === 'maskable'), 'Mall icon needs a maskable variant');
  // No shortcut may point at a staff page from the shopper's manifest.
  for (const shortcut of mall.shortcuts || []) {
    assert.ok(!String(shortcut.url).startsWith('/labs'), `shopper shortcut must not open the staff app: ${shortcut.url}`);
  }
  assert.match(app, /manifest-staff\.json/);
  assert.doesNotMatch(html, /Idofera POS & Investment Planner/);
  assert.match(html, /IdoferaMall/);
  // Both manifests must be precached, or a staff member offline gets no app.
  assert.match(sw, /'\/manifest-staff\.json'/);
});

test('reconnecting refreshes the Mall instead of only flipping the banner', () => {
  const context = fs.readFileSync('src/context/MallContext.tsx', 'utf8');
  assert.match(context, /addEventListener\('online'/);
  assert.match(context, /removeEventListener\('online'/);
  // Guarded, so a flapping connection cannot start a request storm.
  assert.match(context, /reconnectingRef/);
});

test('the IndexedDB mirror flushes pending writes on unmount', () => {
  const source = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
  // A bare `return () => clearTimeout(timer)` cancels the pending write, so a
  // logout inside the debounce window drops the last change from the offline
  // store -- the one store that must survive losing the connection.
  assert.doesNotMatch(source, /const timer = setTimeout\(\(\) => \{\s*replaceStoreItems\('products'/);
  assert.match(source, /pendingMirrors/);
  assert.match(source, /unmount flush/i);
});

test('the storefront boots one catalog request and keeps the staff POS out of the Mall entry', () => {
  const context = fs.readFileSync('src/context/MallContext.tsx', 'utf8');
  const site = fs.readFileSync('src/mall-site/MallSite.tsx', 'utf8');
  // The duplicate boot fetch doubled catalog rows read on every page load.
  assert.doesNotMatch(site, /refreshProducts\(\);\s*\n\s*document\.title/);
  assert.doesNotMatch(context, /mallClient\.health\(\)/);
  assert.doesNotMatch(context, /mallClient\.products\(\{ limit: 60/);

  // StaffApp/StaffProviders must be lazy, or the Suspense in App.tsx is
  // decorative and every shopper downloads the POS.
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/staff\/StaffApp'\)/);
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/staff\/StaffProviders'\)/);
  assert.doesNotMatch(app, /^import \{ StaffApp \}/m);
  assert.doesNotMatch(app, /^import \{ StaffProviders \}/m);

  // The service worker must not claim the storefront has an IndexedDB write path.
  // Match the quoted literals, not the prose, so an explanatory comment about the
  // old wording does not make this test fail.
  const sw = fs.readFileSync('public/sw.js', 'utf8');
  assert.doesNotMatch(sw, /message: 'You are currently offline\./);
  assert.doesNotMatch(sw, /'Offline Mode Active'/);
  assert.match(sw, /error: 'You appear to be offline\.'/);
  assert.match(sw, /ASSET_CACHE_MAX/);
  assert.match(sw, /SHELL_ASSETS = \['\/index\.html'\]/);
});

test('mall header exposes accessible cancellable live search without staff data', () => {
  const source = fs.readFileSync('src/mall-site/MallHeaderSearch.tsx', 'utf8');
  const header = fs.readFileSync('src/mall-site/MallHeader.tsx', 'utf8');
  assert.match(header, /<MallHeaderSearch/);
  for (const pattern of [/PortalDropdown/, /role="combobox"/, /role="listbox"/, /role="option"/, /aria-activedescendant/, /ArrowDown/, /ArrowUp/, /Escape/, /event.metaKey/, /controller.abort\(\)/, /!controller.signal.aborted/, /window.clearTimeout/, /result\?\.query === cleanQuery/, /View all results/, /Retry suggestions/]) assert.match(source, pattern);
  assert.doesNotMatch(source, /useApp|AppContext|useAuth|\/api\/staff/);
});

test('Mall cards reveal the exact stock count only once the item is in the cart', () => {
  assert.equal(mallStockLabel(250), '250 left');
  assert.equal(mallStockLabel(1000), '1,000 left');
  assert.equal(mallStockLabel(11), '11 left');
  assert.equal(mallStockLabel(10), 'Only 10 left');
  assert.equal(mallStockLabel(1), 'Only 1 left');
  assert.equal(mallStockLabel(0), 'Out of stock');
  assert.equal(mallAvailabilityLabel(250), 'In stock');
  assert.equal(mallAvailabilityLabel(1), 'In stock');
  assert.equal(mallAvailabilityLabel(0), 'Out of stock');

  // Card: binary until the item is in the cart, exact count after.
  const card = fs.readFileSync('src/mall-site/MallProductCard.tsx', 'utf8');
  assert.match(card, /qty > 0 \? mallStockLabel\(product\.stock\) : mallAvailabilityLabel\(product\.stock\)/);
  assert.doesNotMatch(card, /product.available && product.stock <= 10/);

  // Header search rows and the product detail page stay binary.
  const search = fs.readFileSync('src/mall-site/MallHeaderSearch.tsx', 'utf8');
  assert.match(search, /mallAvailabilityLabel\(product\.stock\)/);
  assert.doesNotMatch(search, /mallStockLabel/);
  const detail = fs.readFileSync('src/mall-site/MallProductPage.tsx', 'utf8');
  assert.match(detail, /mallAvailabilityLabel\(product\.stock\)/);
  assert.doesNotMatch(detail, /in stock`/);

  // The cart is where the exact count is revealed.
  const cartLines = fs.readFileSync('src/mall-site/MallCartLines.tsx', 'utf8');
  assert.match(cartLines, /mallStockLabel\(it\.stock\)/);
  const cartRow = fs.readFileSync('src/components/mall/MallCartItemRow.tsx', 'utf8');
  assert.match(cartRow, /mallStockLabel\(item\.stock\)/);
});

test('homepage keeps ordered single-row carousels and the original catalog grid', () => {
  const home = fs.readFileSync('src/mall-site/MallHome.tsx', 'utf8');
  const sections = fs.readFileSync('src/mall-site/MallSections.tsx', 'utf8');
  const carousel = fs.readFileSync('src/mall-site/MallCarousel.tsx', 'utf8');
  const positions = ['<MallFlashSales', 'id="mall-categories"', 'title="Top Sellers"', 'title="New Arrivals"', 'title="Explore the Mall"'].map(text => home.indexOf(text));
  assert.ok(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1])));
  assert.match(home, /sections\?\.buyAgain.length/);
  assert.match(home, /title="Buy Again"[^\n]*limit=\{10\}/);
  assert.doesNotMatch(home, /Official Store|\.reverse\(/);
  assert.match(sections, /categories.slice\(0, 10\)/);
  assert.match(sections, /discountPct\(p\) != null\).slice\(0, 10\)/);
  assert.match(sections, /limit = 12/);
  assert.doesNotMatch(sections, /grid-cols/);
  assert.match(carousel, /flex-nowrap/);
  assert.match(carousel, /snap-mandatory/);
  assert.match(carousel, /aria-controls/);
  assert.match(carousel, /ArrowLeft/);
  assert.match(carousel, /prefers-reduced-motion/);
  assert.doesNotMatch(carousel, /setInterval/);
});

test('public routes preserve category, product and search parameters', () => {
  assert.deepEqual(parseRoute('/category/Bottles', ''), { surface: 'mall', page: 'category', param: 'Bottles' });
  assert.deepEqual(parseRoute('/product/prod-1', ''), { surface: 'mall', page: 'product', param: 'prod-1' });
  assert.deepEqual(parseRoute('/search', '?q=plain+bottle'), { surface: 'mall', page: 'search', param: 'plain bottle' });
});

test('staff routes are deep-linkable', () => {
  assert.deepEqual(parseRoute('/labs/pos', ''), { surface: 'staff', staffPage: 'pos' });
  assert.deepEqual(parseRoute('/labs/reports', ''), { surface: 'staff', staffPage: 'reports' });
  assert.deepEqual(parseRoute('/labs/mall-orders', ''), { surface: 'staff', staffPage: 'mall-orders' });
  assert.deepEqual(parseRoute('/labs', ''), { surface: 'staff', staffPage: undefined });
});

test('staff login opens the labs workspace via a full-page deep link', () => {
  const footer = fs.readFileSync('src/mall-site/MallFooter.tsx', 'utf8');
  const header = fs.readFileSync('src/mall-site/MallHeader.tsx', 'utf8');
  // Full-page navigation (not client-side go()) so the staff app boots fresh;
  // the worker/express SPA fallback must then serve index.html for /labs.
  assert.doesNotMatch(footer, /Staff Login|\/labs/);
  assert.match(header, /window\.location\.href = '\/labs'/);
  assert.equal(header.match(/\.\.\.cartHold/g)?.length, 2);
  assert.deepEqual(parseRoute('/labs', ''), { surface: 'staff', staffPage: undefined });
});

test('cart hold opens staff only after three seconds and suppresses the following click', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let opened = 0;
  const hold = createStaffCartHold(() => opened++);
  hold.start(1, 20, 20, 0, true);
  t.mock.timers.tick(STAFF_CART_HOLD_MS - 1);
  assert.equal(opened, 0);
  t.mock.timers.tick(1);
  assert.equal(opened, 1);
  hold.end(1);
  assert.equal(hold.shouldSuppressClick(), true);
  t.mock.timers.tick(3000);
  assert.equal(opened, 1);
  hold.start(2, 20, 20, 0, true);
  hold.end(2);
  assert.equal(hold.shouldSuppressClick(), false);
});

test('short cart press preserves clicks; movement and cancellation prevent staff navigation', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let opened = 0;
  const hold = createStaffCartHold(() => opened++);
  hold.start(1, 20, 20, 0, true);
  t.mock.timers.tick(500);
  hold.end(1);
  assert.equal(hold.shouldSuppressClick(), false);
  t.mock.timers.tick(3000);
  assert.equal(opened, 0);
  for (const cancel of [() => hold.move(1, 40, 20), () => hold.cancel()]) {
    hold.start(1, 20, 20, 0, true);
    cancel();
    t.mock.timers.tick(3000);
    assert.equal(opened, 0);
    assert.equal(hold.shouldSuppressClick(), true);
  }
  hold.start(1, 20, 20, 2, true);
  t.mock.timers.tick(3000);
  hold.start(2, 20, 20, 0, false);
  t.mock.timers.tick(3000);
  assert.equal(opened, 0);
});

test('legacy staff routes remain recognizable for canonical redirects', () => {
  assert.deepEqual(parseRoute('/app/pos', ''), { surface: 'staff', staffPage: 'pos', legacyPath: true });
  assert.deepEqual(parseRoute('/app', ''), { surface: 'staff', staffPage: undefined, legacyPath: true });
});

test('checkout validation requires a name, plausible phone and an optional valid email', () => {
  assert.equal(validateBuyer('', '08031234567'), 'Please enter your name.');
  assert.equal(validateBuyer('Ada', '123'), 'Enter a valid phone number.');
  assert.equal(validateBuyer('Ada', '0803 123 4567'), '');
  assert.equal(validateBuyer('Ada', '0803 123 4567', 'not-an-email'), 'Enter a valid email address.');
  assert.equal(validateBuyer('Ada', '0803 123 4567', 'ada@example.com'), '');
  assert.equal(validateBuyer('Ada', '0803 123 4567', ''), '', 'email stays optional');
});

test('fixed delivery zones expose canonical fees', () => {
  assert.equal(mallDeliveryFeeKobo('pickup'), 0);
  assert.equal(mallDeliveryFeeKobo('uyo_central'), 150000);
  assert.equal(mallDeliveryFeeKobo('uyo_outer'), 250000);
  assert.equal(mallDeliveryFeeKobo('other'), null);
  assert.equal(mallDeliveryZone('invalid'), 'pickup');
});

test('day keys are built from the local calendar, not UTC', () => {
  // Constructed locally: 00:30 on June 15 is the local June 15 in ANY
  // timezone, while toISOString() renders June 14 under UTC+1 — the exact
  // way a WAT sale taken after midnight used to drop out of Today's Sales.
  const earlyMorning = new Date(2026, 5, 15, 0, 30);
  assert.equal(localIsoDate(earlyMorning), '2026-06-15');
  assert.equal(localIsoDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('dashboard and AI day filters use localIsoDate, never toISOString', () => {
  for (const file of ['src/components/dashboard/DashboardView.tsx', 'src/components/ai/AiAssistantView.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /toISOString\(\)\.split\('T'\)\[0\]/, `${file} must not build day keys from UTC`);
    assert.match(source, /localIsoDate\(/, `${file} must build day keys from the local calendar`);
  }
});

test('development bootstrap prevents stale service workers from mixing React modules', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const bootstrap = fs.readFileSync('src/bootstrap.ts', 'utf8');
  const pwaHook = fs.readFileSync('src/hooks/usePWAInstall.ts', 'utf8');
  const worker = fs.readFileSync('public/sw.js', 'utf8');
  assert.match(html, /src\/bootstrap\.ts/);
  assert.match(bootstrap, /getRegistrations\(\)/);
  assert.match(bootstrap, /registration\.unregister\(\)/);
  assert.match(pwaHook, /import\.meta\.env\.PROD/);
  assert.match(worker, /node_modules\/\.vite/);
  assert.match(worker, /cached \|\| new Response/);
});

test('portal dropdown menus stack above every modal layer', () => {
  // AccessibleOverlay renders modals at z-[9999]; plain modals use z-50.
  assert.ok(PORTAL_DROPDOWN_Z > 9999, `portal dropdown z-index ${PORTAL_DROPDOWN_Z} must exceed the modal layer`);
});

test('dropdown menus flip above the anchor when they do not fit below it', () => {
  const viewport = { width: 1024, height: 800 };
  // Anchor near the viewport bottom: 58px free below, 694px above → flip up.
  const flipped = computeMenuStyle({ left: 24, top: 700, width: 300, height: 36 }, viewport, 192);
  assert.equal(flipped.top, undefined);
  assert.equal(flipped.bottom, 106); // viewport.height - anchor.top + gap
  assert.equal(flipped.maxHeight, 192);
  // Anchor near the top: plenty of room below → open downward.
  const below = computeMenuStyle({ left: 24, top: 10, width: 300, height: 36 }, viewport, 192);
  assert.equal(below.bottom, undefined);
  assert.equal(below.top, 52); // anchor.top + anchor.height + gap
  assert.equal(below.maxHeight, 192);
});

test('dropdown menus clamp to the viewport and keep a usable minimum height', () => {
  const viewport = { width: 1024, height: 800 };
  // Anchor poking past the right edge: the menu must not overflow the viewport.
  const clamped = computeMenuStyle({ left: 1000, top: 100, width: 300, height: 36 }, viewport, 192);
  assert.equal(clamped.left, 724); // viewport.width - anchor.width
  assert.equal(clamped.width, 300);
  // Squeezed between viewport edges: the menu never collapses below 96px.
  const squeezed = computeMenuStyle({ left: 0, top: 86, width: 300, height: 36 }, { width: 1024, height: 200 }, 192);
  assert.equal(squeezed.maxHeight, 96);
});

test('in-modal dropdown menus render through portals instead of clipped absolute layers', () => {
  const portal = fs.readFileSync('src/components/common/PortalDropdown.tsx', 'utf8');
  assert.match(portal, /createPortal\(/);
  for (const file of ['src/components/modals/AddProductModal.tsx', 'src/components/purchases/ProductSearchPicker.tsx', 'src/mall-site/MallCategoryNav.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /PortalDropdown/, `${file} must render its dropdown through PortalDropdown`);
    assert.doesNotMatch(source, /top-full/, `${file} must not anchor dropdowns with clipped absolute positioning`);
  }
});

test('Mall exposes the paginated catalog and disables sold-out purchase controls', () => {
  const grid = fs.readFileSync('src/mall-site/MallBrowseGrid.tsx', 'utf8');
  assert.match(grid, /const PAGE_SIZE = 10/);
  assert.match(grid, /Showing \{items.length\} of \{total\}/);
  assert.match(grid, /xl:grid-cols-5/);
  assert.match(grid, /Retry loading more/);
  assert.match(grid, /setMoreError\(reason/);
  assert.match(grid, /request\(nextOffset.current\)/);
  assert.match(grid, /currentGeneration !== generation.current/);
  assert.match(grid, /You’ve viewed all/);
  const home = fs.readFileSync('src/mall-site/MallHome.tsx', 'utf8');
  const card = fs.readFileSync('src/mall-site/MallProductCard.tsx', 'utf8');
  const detail = fs.readFileSync('src/mall-site/MallProductPage.tsx', 'utf8');
  assert.match(home, /MallBrowseGrid title="Explore the Mall"/);
  assert.match(home, /fetchFn=\{fetchSearch\(''\)\}/);
  assert.match(card, /qty > 0 && purchasable/);
  assert.match(card, /disabled=\{adding \|\| !purchasable\}/);
  assert.match(card, /purchasable \? 'Add to Cart' : mallUnavailableLabel\(product\)/);
  assert.match(detail, /MallQuantityControl[^\n]*disabled=\{adding \|\| !purchasable\}/);
  for (const source of [card, detail]) assert.match(source, /hasMallPrice\(product.price\) \? formatNaira\(product.price\) : 'Price unavailable'/);
  assert.match(detail, /Product description has not been provided yet/);
  assert.match(detail, /product\.wholesaleOffer/);
  assert.match(detail, /Buy \{product\.wholesaleOffer\.minQty\}\+ at \{formatNaira\(product\.wholesaleOffer\.price\)\} each/);
  assert.match(detail, /Wholesale price \{formatNaira\(product\.wholesaleOffer\.price\)\} each applies at this quantity/);
  const cartLines = fs.readFileSync('src/mall-site/MallCartLines.tsx', 'utf8');
  assert.match(card, /product\.wholesaleOffer/);
  assert.match(card, /formatNaira\(product\.wholesaleOffer\.price\)\} each at \$\{product\.wholesaleOffer\.minQty\}\+/);
  assert.match(card, /Wholesale price applied/);
  assert.match(card, /bg-emerald-50 dark:bg-emerald-900\/30/);
  assert.match(cartLines, /it\.listPrice != null && it\.price < it\.listPrice/);
  assert.match(cartLines, />Wholesale</);
  assert.match(cartLines, /Add \{it\.wholesaleOffer!\.minQty - it\.qty\} more → \{formatNaira\(it\.wholesaleOffer!\.price\)\} each · save \{formatNaira\(\(it\.price - it\.wholesaleOffer!\.price\) \* it\.wholesaleOffer!\.minQty\)\}/);
  assert.match(cartLines, /inline-flex items-center gap-1\.5 self-start rounded-lg/, 'the per-item CTA is the compact inline pill');
  assert.match(cartLines, /it\.wholesaleOffer\.minQty <= it\.stock/, 'the CTA only invites thresholds the stock can reach');
  assert.match(cartLines, /Add \{formatNaira\(unlock\.extra\)\} more → wholesale/);
  assert.match(cartLines, /\{unlock\.it\.name\}: \{formatNaira\(unlock\.offer\.price\)\} each, save \{formatNaira\(unlock\.saving\)\}/);
  assert.match(cartLines, /mt-1\.5 h-8 px-3 rounded-lg/, 'compact auto-width unlock button');
  assert.match(cartLines, /setCartQty\(unlock\.it\.productId, unlock\.offer\.minQty\)/, 'one-tap Unlock jumps the line to the threshold');
  const search = fs.readFileSync('src/mall-site/MallHeaderSearch.tsx', 'utf8');
  assert.match(search, /product\.wholesaleOffer \? ` · \$\{formatNaira\(product\.wholesaleOffer\.price\)\} each at \$\{product\.wholesaleOffer\.minQty\}\+`/);
});

test('checkout customer card does not scroll over the payment method fieldset', () => {
  const checkout = fs.readFileSync('src/mall-site/MallCheckout.tsx', 'utf8');
  assert.match(checkout, /Payment method/);
  assert.doesNotMatch(checkout, /lg:sticky/);
});
test('schema marker is checked before the bootstrap so cold isolates do not replay it', () => {
  const workerSource = fs.readFileSync('sites-worker.ts', 'utf8');
  assert.ok(
    workerSource.indexOf('await schemaVersionCurrent(env)') < workerSource.indexOf('const statements: D1PreparedStatement[] = ['),
    'the marker lookup must run before the DDL list is built',
  );
  assert.match(workerSource, /SELECT 1 AS present FROM mall_schema_versions WHERE version = \?/);
  // The marker is recorded only after the additive schema is in place.
  assert.ok(
    workerSource.indexOf('for (const index of MALL_CATALOG_INDEXES)') <
    workerSource.indexOf('INSERT OR IGNORE INTO mall_schema_versions(version, installed_at) VALUES (?, ?)'),
  );
});

test('dashboard revalidates the snapshot instead of re-reading every document', () => {
  const source = fs.readFileSync('src/services/d1StorageService.ts', 'utf8');
  const read = source.slice(source.indexOf('async function readCloudSnapshot'), source.indexOf('async function writeSnapshot'));
  assert.match(read, /headers\['if-none-match'\] = `"\$\{knownGuard\}"`/);
  assert.match(read, /if \(response\.status === 304\)/);
  assert.match(read, /rememberSnapshotGuard\(cloud\.revision, cloud\.backend \|\| 'documents'\)/);
  // A 304 carries no revision of its own: never overwrite the stored one.
  assert.doesNotMatch(read, /localStorage\.setItem\(REVISION_KEY/);
  const init = source.slice(source.indexOf('export async function initializeD1Storage'), source.indexOf('export async function pullLatestFromD1'));
  assert.ok(init.indexOf('if (cloud.notModified) return null;') >= 0, 'a 304 must merge nothing');
  const pull = source.slice(source.indexOf('export async function pullLatestFromD1'), source.indexOf('export function queueD1Snapshot'));
  assert.ok(pull.indexOf('if (cloud.notModified) return null;') >= 0, 'a 304 must merge nothing on pull');
});

test('open staff workspaces revalidate sessions without polling hidden tabs', () => {
  const auth = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
  assert.match(auth, /const SESSION_RECHECK_MS = 120000;/);
  assert.match(auth, /const poll = \(\) => \{ if \(!document\.hidden\) void check\(\); \};/);
  assert.match(auth, /window\.setInterval\(poll, SESSION_RECHECK_MS\)/);
  assert.match(auth, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.doesNotMatch(auth, /setInterval\(check, 30000\)/);
});

test('staff sync stays quiet in the background and counts stay opt-in', () => {
  const hook = fs.readFileSync('src/hooks/useCloudSync.ts', 'utf8');
  // The cadence is sourced from d1StorageService so the badge's label and the
  // poll interval can never disagree again. Both assertions below hold whatever
  // the value becomes; the value itself is pinned on the service, where the
  // badge reads its label from.
  assert.match(hook, /const AUTO_PING_INTERVAL_MS = D1_AUTO_PING_INTERVAL_MS;/);
  assert.doesNotMatch(hook, /const AUTO_PING_INTERVAL_MS = 5 \* 60 \* 1000;/);
  const service = fs.readFileSync('src/services/d1StorageService.ts', 'utf8');
  assert.match(service, /export const D1_AUTO_PING_MINUTES = 15;/);
  assert.doesNotMatch(service, /export const D1_AUTO_PING_MINUTES = 5;/);
  // The label is derived, never a literal — three hardcoded "Every 5 minutes"
  // strings once promised 3x the monitoring the hook actually ran.
  assert.match(service, /export const D1_AUTO_PING_INTERVAL_LABEL = `Every \$\{D1_AUTO_PING_MINUTES\} minutes`;/);
  const badge = fs.readFileSync('src/components/common/D1NetworkHealthBadge.tsx', 'utf8');
  assert.equal(/every 5 minutes|Every 5 minutes|every 5 mins/.test(badge), false, 'the badge must not hardcode a cadence');
  assert.match(badge, /D1_AUTO_PING_INTERVAL_LABEL/);
  assert.match(hook, /function sharedD1Health\(detail: boolean, force: boolean\)/);
  assert.match(hook, /if \(healthInFlight && !detail\) return healthInFlight;/);
  assert.match(hook, /if \(!detail && !force && lastHealthStatus && Date\.now\(\) - lastHealthPingAt < AUTO_PING_INTERVAL_MS\)/);
  const health = fs.readFileSync('src/services/d1StorageService.ts', 'utf8');
  assert.match(health, /const healthUrl = detail \? '\/api\/storage\/d1\/health\?detail=1' : '\/api\/storage\/d1\/health';/);
  const workerSource = fs.readFileSync('sites-worker.ts', 'utf8');
  assert.match(workerSource, /searchParams\.get\('detail'\) === '1'/);
});

test('automatic save batches only changed records and never reads deltas', () => {
  const hook = fs.readFileSync('src/hooks/useCloudSync.ts', 'utf8');
  assert.match(hook, /autoSyncChangedRecords\(changes, deps\)/);
  assert.match(hook, /getItem<Record<string, unknown>>\(collection, documentId\)/);
  const flush = hook.slice(hook.indexOf('const flushAutoSync = useCallback'), hook.indexOf('}, []);', hook.indexOf('const flushAutoSync = useCallback')));
  assert.doesNotMatch(flush, /getAllItems/);
  const service = fs.readFileSync('src/services/d1StorageService.ts', 'utf8');
  assert.match(service, /export const AUTO_SYNC_DEBOUNCE_MS = 2000;/);
  // Option B: the delta subsystem is gone — no watermark cursor, no delta read,
  // no app-level delta applier. Convergence rides the revision-guarded full read.
  assert.doesNotMatch(service, /readSnapshotDelta|registerDeltaApplier|readDeltaCursor/);
  assert.match(service, /const SYNC_ENGINE_VERSION = 1;/);
  // A bounded (capped) response must merge by id instead of truncating a store.
  assert.match(service, /mergeRemoteWithPendingLocal\(local: D1Snapshot, remote: D1Snapshot, capped\?: ReadonlySet<string>\)/);
  const workerSource = fs.readFileSync('sites-worker.ts', 'utf8');
  assert.doesNotMatch(workerSource, /SNAPSHOT_DELTA_LIMIT/);
  assert.doesNotMatch(workerSource, /searchParams\.get\('since'\)/);
});

test('a sale edit keeps a modification timestamp all the way to D1', () => {
  const app = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
  const start = app.indexOf('const updateSale = (');
  assert.ok(start > 0, 'updateSale must exist');
  const body = app.slice(start, app.indexOf('// Reconcile Historical Sales', start));

  // The sync merge ranks copies with `updatedAt || _lastSyncedAt || createdAt`,
  // and createdAt is deliberately preserved as the original transaction time. An
  // unstamped sale edit is therefore indistinguishable from an unedited record,
  // so the next D1 read silently reverts it.
  assert.match(body, /updatedAt: now,/);
  // saveDocument stamps _lastSyncedAt; a bare putItem on the same key commits
  // after it and erases that stamp.
  assert.doesNotMatch(body, /putItem\('sales'/);
  // A refused edit must report false so the caller keeps the editor open.
  assert.match(body, /\): boolean => \{/);
  assert.match(body, /return false;/);
  assert.match(body, /return true;/);

  // The stamp has to survive the relational store too: without the column the
  // server drops it and the snapshot read-back has none.
  const ddl = fs.readFileSync('src/server/relationalDdl.ts', 'utf8');
  const salesDdl = ddl.split('\n').find((line) => line.includes('CREATE TABLE IF NOT EXISTS sales '));
  assert.ok(salesDdl, 'the sales table DDL must exist');
  assert.match(salesDdl, /updated_at text/);
  assert.match(
    fs.readFileSync('src/server/mallOperations.ts', 'utf8'),
    /ALTER TABLE sales ADD COLUMN updated_at TEXT/,
  );
  const mapper = fs.readFileSync('src/server/relationalMapper.ts', 'utf8');
  assert.match(mapper, /updated_at: doc\.updatedAt \? s\(doc\.updatedAt\) : null/);
  assert.match(mapper, /updatedAt: r\.updated_at \|\| undefined/);

  // Both editors close only on a confirmed write.
  const salesView = fs.readFileSync('src/components/sales/SalesView.tsx', 'utf8');
  const editModal = fs.readFileSync('src/components/sales/EditSaleModal.tsx', 'utf8');
  assert.match(salesView, /const saved = updateSale\(/);
  assert.match(salesView, /if \(saved\) setEditSaleTarget\(null\);/);
  assert.match(editModal, /const saved = updateSale\(/);
  assert.match(editModal, /if \(!saved\) return;/);

  // The Mall staff API writes `sales` with raw SQL and so bypasses the mapper.
  // Both of those writes mutate a real sale, so both must carry the same clock or
  // a Mall-side change is indistinguishable from an untouched invoice.
  const mallAdmin = fs.readFileSync('src/server/mallOrderAdminApi.ts', 'utf8');
  const mallSalesWrites = mallAdmin.match(/sql: `(?:INSERT INTO|UPDATE) sales[\s\S]*?`,/g) || [];
  assert.equal(mallSalesWrites.length, 2, 'both raw sales writes must still be present');
  for (const write of mallSalesWrites) {
    assert.match(write, /updated_at/, 'every raw sales write must set updated_at');
  }
});

test('an invoice edit cascades every editable field to its linked records', () => {
  const app = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
  const start = app.indexOf('const updateSale = (');
  assert.ok(start > 0, 'updateSale must exist');
  const body = app.slice(start, app.indexOf('// Reconcile Historical Sales', start));

  // Gap A — flipping status to a refund state must refuse and route through
  // the refund pipeline (stock restore, refunds[], settlement, treasury).
  assert.match(body, /Use the Refund Flow/);
  assert.match(body, /updates\.status === 'Refunded'/);
  assert.match(body, /updates\.status === 'Partially Refunded'/);
  // Gap F — a Retail<->Wholesale flip reprices catalogue lines from the book.
  assert.match(body, /nextType === 'Wholesale' \? catalogue\.wholesalePrice : catalogue\.retailPrice/);
  // Gap E — leaving Split clears the stale breakdown; entering Split keeps data.
  assert.match(body, /finalPaymentBreakdown/);
  assert.match(body, /paymentBreakdown: finalPaymentBreakdown/);
  // Gap B — delivery-only keys are stripped before the sale is built so they
  // never pollute the sale blob that saleToRows() cannot persist.
  assert.match(body, /deliveryOnlyAddress/);
  assert.match(body, /\.\.\.saleUpdates,/);
  assert.doesNotMatch(body, /\.\.\.existing,\n\s+\.\.\.updates,\n\s+customerName/);
  // Gap C — fee-to-zero deletes the orphan delivery; pickup gets by+at stamps;
  // customerId re-aligns after the ownership transfer resolves.
  assert.match(body, /deletedDeliveryOrderId/);
  assert.match(body, /pickupConfirmedBy: finalPickupConfirmed/);
  assert.match(body, /customerId: updatedSale\.customerId, customerName: updatedSale\.customerName/);
  // Gap D — expense update uses fresh courier notes + synced title/paidBy, and
  // the pickup auto-create links its id back onto the sale and the delivery.
  assert.match(body, /freshCourierNotes/);
  assert.match(body, /syncedExpenseTitle/);
  assert.match(body, /updatedSale\.expenseId = newExpense\.id/);
  assert.match(body, /\.\.\.matchingDeliveryOrder, expenseId: newExpense\.id/);
  // Gap H — dispatch contact corrections reach the customer directory.
  assert.match(body, /phone: deliveryOnlyPhone/);
  assert.match(body, /address: deliveryOnlyAddress/);
  // Gap G — the pre-order mirrors the sale's own subtotal/discount/fee total.
  assert.match(body, /Math\.max\(0, subtotal - disc \+ newFee\)/);
  assert.match(body, /customerId: updatedSale\.customerId \|\| linkedPreOrder\.customerId/);
  // Gap E (treasury) — editing an invoice must reconcile its Sale Inflow
  // money movements: remove the stale channel record(s) and rebuild from the
  // finalized method/paid amount, keeping historical sales free of inflows.
  assert.match(body, /removedFlows/);
  assert.match(body, /m\.type === 'Sale Inflow' && m\.referenceId === saleId/);
  assert.match(body, /if \(!isHistorical\)/);
  assert.match(body, /destinationAccount: 'Physical Cash'/);
  assert.match(body, /destinationAccount: 'Biz Account'/);
  assert.match(body, /finalPaymentMethod === 'Split'/);
  assert.match(body, /newFlows\.forEach/);

  // Both edit forms must stop offering Refunded as a target — the refund flow
  // owns that transition, so the edit status selects keep only non-refund
  // states (plus a read-only echo when the invoice is already refunded).
  // NOTE: SalesView also has a *list filter* dropdown that legitimately keeps
  // Refunded/Partially Refunded as filter targets — scope to the edit region.
  const editModal = fs.readFileSync('src/components/sales/EditSaleModal.tsx', 'utf8');
  assert.doesNotMatch(editModal, /<option value="Refunded">Refunded<\/option>/);
  assert.match(editModal, /use Process Refund/);
  const salesView = fs.readFileSync('src/components/sales/SalesView.tsx', 'utf8');
  const editRegion = salesView.slice(salesView.indexOf('Edit Sale Record Modal'));
  assert.ok(editRegion.length > 0, 'the inline edit modal must still exist');
  assert.doesNotMatch(editRegion, /<option value="Refunded">Refunded<\/option>/);
  assert.match(editRegion, /use Process Refund/);
});

test('a loan repayment nets back against owner drawings and loans', () => {
  const app = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
  const start = app.indexOf('const treasuryBalances = useMemo');
  assert.ok(start > 0, 'treasuryBalances reducer must exist');
  const body = app.slice(start, app.indexOf('}, [moneyMovements]);', start));

  // An Owner Repayment should reduce both the net drawings KPI and the
  // outstanding-loans ledger — not just ownerLoans — so the dashboard reflects
  // funds actually returned to the business, not the gross withdrawal.
  assert.match(body, /mv\.type === 'Owner Repayment'/);
  // Order-independent: sum drawings and repayments separately, then net.
  // A repayment recorded before its loan (prepay, or a sync reorder) must not
  // floor to zero mid-walk and lose the loan.
  assert.match(body, /grossOwnerDrawings/);
  assert.match(body, /ownerRepayments \+= amt/);
  assert.match(body, /netOwnerDrawings = Math\.max\(0, grossOwnerDrawings - ownerRepayments\)/);
  assert.match(body, /netOwnerLoans = Math\.max\(0, grossOwnerLoans - ownerRepayments\)/);
  assert.match(body, /totalOwnerDrawings: Number\(netOwnerDrawings\.toFixed\(2\)\)/);
  assert.match(body, /totalOwnerLoans: Number\(netOwnerLoans\.toFixed\(2\)\)/);
});

test('a repayment can settle a specific owner loan', () => {
  const types = fs.readFileSync('src/types/index.ts', 'utf8');
  assert.match(types, /loanReferenceId\?: string/);
  assert.match(types, /the movement id of the Owner Loan drawing settled/);

  const modal = fs.readFileSync('src/components/treasury/OwnerWithdrawalModal.tsx', 'utf8');
  assert.match(modal, /outstandingLoans/);
  assert.match(modal, /Settle Against Loan/);
  assert.match(modal, /loanReferenceId: loanReferenceId \|\| undefined/);

  // The link must round-trip through relational storage so it survives a
  // D1 sync: the mapper writes it to ref_id for repayments and the snapshot
  // reads it back into loanReferenceId.
  assert.match(fs.readFileSync('src/server/relationalMapper.ts', 'utf8'), /repaymentLoanLink/);
  assert.match(fs.readFileSync('src/server/relationalSnapshot.ts', 'utf8'), /loanReferenceId: r\.type === 'Owner Repayment'/);
});

test('the Node runtime ships no Cloudflare REST write engine', () => {
  const server = fs.readFileSync('server.ts', 'utf8');
  // The deployed Worker owns D1: no credentials, no REST /query executor, no
  // token-config route, and no startup hydration from the edge.
  assert.doesNotMatch(server, /api\.cloudflare\.com/);
  assert.doesNotMatch(server, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(server, /executeRemoteD1Statements|pushRelationalD1Statements|mergeInsertStatements|updateEnvFile/);
  assert.doesNotMatch(server, /syncFromCloudflareD1|remoteSync/);
  assert.doesNotMatch(server, /"\/api\/storage\/d1\/(config|pull|push-full|migrate-historical)"/);
  // The local status route stays (the health badge reads it) and a real write still
  // reports relational success, so the client's guard stays honest.
  assert.match(server, /app\.get\("\/api\/storage\/d1\/health"/);
  assert.match(server, /relationalSynced: true/);
  // No runtime prompts for a Cloudflare token any more.
  for (const file of ['src/components/common/D1NetworkHealthBadge.tsx', 'src/components/settings/SettingsView.tsx']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /apiToken|D1Config/);
  }
});

test('the mall mirror layer stays deleted', () => {
  assert.equal(fs.existsSync('src/server/mallMirror.ts'), false);
  for (const file of ['src/server/mallApi.ts', 'src/server/mallOrderAdminApi.ts']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /mallMirror|mirrorMall/);
  }
});

test('the edge serves the relational catalog and never falls back to documents', () => {
  // 100% relational: the document fallback was removed with `app_documents`.
  // The snapshot is built straight from the relational tables, and the source
  // must not reference the document store at all.
  const workerSource = fs.readFileSync('sites-worker.ts', 'utf8');
  assert.doesNotMatch(workerSource, /FROM app_documents/);
  assert.doesNotMatch(workerSource, /INTO sync_revisions/);
  assert.match(workerSource, /async function currentWatermark\(env: Env\)/);
  assert.match(workerSource, /await buildSnapshot\(makeD1QueryAll\(env\)\)/);
});



test('unchanged store answers 304 and a stale token still returns the catalog', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const prepare = (sql: string) => ({
    sql, params: [] as unknown[],
    bind(...params: unknown[]) { this.params = params; return this; },
    async all() { return { results: db.prepare(sql).all(...this.params as any[]) }; },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...this.params as any[]).changes) } }; },
  });
  const env = {
    DB: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
        return statements.map((st) => ({ meta: { changes: Number(db.prepare(st.sql).run(...st.params as any[]).changes) } }));
      },
    },
    ASSETS: { fetch: async () => new Response('asset') },
  } as unknown as Parameters<typeof worker.fetch>[1];

  await worker.fetch(new Request('https://test/api/mall/health'), env);
  const token = 'snapshot-guard-session';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare(`INSERT INTO app_users(id,email,display_name,role,status,password_hash,password_salt,created_at)
    VALUES ('staff','staff@test.invalid','Manager','Administrator','Active','x','y','now')`).run();
  db.prepare('INSERT INTO app_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(hash, 'staff', Date.now(), Date.now() + 60000);
  db.prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES ('sync_watermark', ?, ?)`)
    .run(JSON.stringify(7), Date.now());
  const cookie = { cookie: `idofera_session=${token}` };

  const first = await worker.fetch(new Request('https://test/api/storage/snapshot?fresh=true', { headers: cookie }), env);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('etag'), '"7-relational"');
  assert.equal((await first.json() as any).hasData, true);

  const guarded = await worker.fetch(new Request('https://test/api/storage/snapshot?fresh=true', {
    headers: { ...cookie, 'if-none-match': '"7-relational"' },
  }), env);
  assert.equal(guarded.status, 304);
  assert.equal(guarded.headers.get('etag'), '"7-relational"');
  assert.equal(await guarded.text(), '');

  const stale = await worker.fetch(new Request('https://test/api/storage/snapshot?fresh=true', {
    headers: { ...cookie, 'if-none-match': '"6-relational"' },
  }), env);
  assert.equal(stale.status, 200);
  assert.ok((await stale.json() as any).revision === 7);
});

test('the staff client ships no bundled credentials and derives super-user status from the server flag only', () => {
  const auth = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
  // A literal credential in the client bundle is readable by any script on the
  // page; the shipped constants used to carry the super-admin password verbatim.
  assert.doesNotMatch(auth, /password:\s*'[^']*'/);
  assert.doesNotMatch(auth, /aidy2800|admin123/);
  // Super-user status comes from server-set identity/flags only: a display name
  // that happens to contain a person's name must never promote an account.
  assert.doesNotMatch(auth, /includes\('(michael|aidy|idofera)'\)/);
  // ...and no id/username/e-mail literal may promote an account either. The
  // client's super-user check must reduce to the server-set isSuperAdmin flag.
  assert.match(auth, /return Boolean\(user\.isSuperAdmin\)/);
  assert.doesNotMatch(auth, /user\.id === 'usr-superadmin-idofera'/);
  assert.doesNotMatch(auth, /user\.username === 'idofera'/);
  assert.doesNotMatch(auth, /user\.email === 'michaelidongesit5@gmail\.com'/);
  // The client must not bundle a profile the server never issued: an empty
  // browser used to "sign in" as the phantom super-admin and then take 401 on
  // every private API call.
  assert.doesNotMatch(auth, /id: 'usr-superadmin-idofera'/);
  // Passwords stay in memory for the one request that needs them, so the local
  // mirror may only ever hold profiles.
  assert.match(auth, /const persistable = users\.map\(\(\{ password, \.\.\.profile \}\) => profile\)/);
  assert.doesNotMatch(auth, /JSON\.stringify\(users\)/);
});

test('the staff API refuses cross-account takeover and never acks an unwritten record', () => {
  const node = fs.readFileSync('server.ts', 'utf8');
  const workerSource = fs.readFileSync('sites-worker.ts', 'utf8');
  // A regular Administrator must not rewrite the super-admin or a protected
  // account (that upsert could reset the password), and a password change on
  // another account must revoke that account's live sessions. The guard is the
  // composed super-admin session (DB flag AND IdP group), not a bare column
  // compare — Access identity never grants privilege by itself (docs/staff-access.md).
  assert.match(node, /if \(existing\?\.is_super_admin && !await superAdminSession\(req, actor\)\)/);
  assert.match(node, /DELETE FROM app_sessions WHERE user_id = \?/);
  assert.match(workerSource, /if \(existing\?\.is_super_admin && !await superAdminSession\(request, env, actor\)\) return json/);
  // Account creation/edits are privileged in BOTH runtimes: the shared editor
  // check demands the Administrator role AND a fresh password step-up.
  assert.match(node, /staffEditorCheck\(\{ actor, stepUp:/);
  assert.match(workerSource, /staffEditorCheck\(\{ actor, stepUp:/);
  assert.match(node, /STEP_UP_REQUIRED/);
  assert.match(workerSource, /STEP_UP_REQUIRED/);
  // Records and snapshots are written to the live catalog FIRST; a failed write
  // answers 5xx with the revision untouched, so the client keeps its dirty keys
  // and retries instead of acking records that were never stored.
  assert.match(workerSource, /The live catalog update failed; no records were written and the revision is unchanged\. Retry the sync\./);
  assert.match(workerSource, /The snapshot could not be written to the live catalog; nothing was replaced and the revision is unchanged\. Retry the restore\./);
});

test('a privileged action without a step-up re-prompts instead of dead-ending, and SSO explains itself', () => {
  const auth = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
  const modal = fs.readFileSync('src/components/modals/StepUpModal.tsx', 'utf8');
  const login = fs.readFileSync('src/components/auth/LoginView.tsx', 'utf8');

  // privilegedRequest consumes 403 STEP_UP_REQUIRED, pauses for a password and
  // retries the ORIGINAL request — it never swallows the denial into a dead
  // 403, and an IdP-group failure is a toast, never a retry loop.
  assert.match(auth, /if \(body\.code !== 'STEP_UP_REQUIRED'\) return first;/);
  assert.match(auth, /const password = await askForPassword\(\);[\s\S]*?if \(!password\) return first;[\s\S]*?return await send\(\);/);
  assert.match(auth, /body\.code === 'SUPER_ADMIN_GROUP_REQUIRED'/);

  // The proof is minted BEFORE the caller's promise resolves: a wrong password
  // keeps the prompt OPEN with the server's error instead of releasing a
  // request the server would reject again.
  assert.match(auth, /stepUp\(password\)\s*\.then\(\(confirmed\) => \{ if \(confirmed\) finishStepUp\(password\); \}\)/);
  assert.match(auth, /setStepUpError\(data\.error/);
  assert.match(auth, /onCancel=\{\(\) => finishStepUp\(null\)\}/);

  // The prompt is a plain password field with no stored credential anywhere.
  assert.match(modal, /type="password"/);
  assert.match(modal, /if \(!password \|\| busy\) return;/);
  assert.doesNotMatch(modal, /localStorage|sessionStorage/);
  assert.doesNotMatch(modal, /password:\s*'/);

  // An SSO login that matched no roster account now stays on the staff route
  // with the "confirmed but not provisioned" notice (StaffApp), rather than
  // being redirected to the storefront (whose surface has no AuthProvider to
  // explain with). The email is still persisted so the notice survives reloads.
  assert.match(auth, /ssoUnregistered: boolean;/);
  assert.match(auth, /persistSsoEmail\(accessEmail\)/);
  assert.match(auth, /persistSsoEmail\(null\)/);
  // The unregistered branch ends right after persisting the email: there is no
  // redirect to the storefront between the call and the branch's return.
  assert.match(auth, /persistSsoEmail\(accessEmail\);\r?\n\s*return;\r?\n\s*\}/);
  assert.match(login, /ssoEmail && \(/);
  assert.match(login, /SSO never creates accounts/);

  // The unregistered notice now owns the staff route itself: StaffApp renders
  // an "Access confirmed" screen whenever the confirmed email has no roster
  // account, and the Google sign-in path is kept intact for local development
  // and rollback (Cloudflare Access replaces the form in production only).
  const staff = fs.readFileSync('src/staff/StaffApp.tsx', 'utf8');
  assert.match(staff, /if \(!currentUser && ssoUnregistered && ssoEmail\)/);
  assert.match(staff, /const AccessNotice: React\.FC<\{ email: string \}>/);
  assert.match(login, /loginWithGoogle/);
  assert.match(auth, /const loginWithGoogle = async/);
});

/**
 * A session-capable worker fixture. Mirrors the deployed `app_sessions` shape
 * INCLUDING `last_seen_at`, so a test that exercises the idle window is testing
 * the real column rather than a simplified stand-in.
 */
function sessionFixture() {
  const f = entranceFixture();
  f.db.exec(`CREATE TABLE app_users (id TEXT, status TEXT);
    CREATE TABLE app_sessions (token_hash TEXT, user_id TEXT, created_at INTEGER, expires_at INTEGER, last_seen_at INTEGER);
    INSERT INTO app_users VALUES ('staff', 'Active');`);
  const DB = {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        all: async () => ({ results: await f.query(sql, params) }),
        run: async () => f.db.prepare(sql).run(...params),
      })
    })
  };
  const env = (extra: Record<string, unknown> = {}) => ({
    DB,
    ASSETS: { fetch: async () => new Response('staff shell', { headers: { 'content-type': 'text/html' } }) },
    ...extra,
  } as unknown as Parameters<typeof worker.fetch>[1]);
  const seed = (tokenHash: string, mintedAt: number, expiresAt: number, lastSeenAt: number) =>
    f.db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?, ?, ?)').run(tokenHash, 'staff', mintedAt, expiresAt, lastSeenAt);
  return { f, env, seed };
}

const hashOf = (token: string) => crypto.subtle
  .digest('SHA-256', new TextEncoder().encode(token))
  .then((buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(''));

/**
 * The gate must answer "is this person signed in?" BEFORE `ensureSchema` can run,
 * so between a deploy and the first migration pass `app_sessions` has no
 * `last_seen_at`. That window 500-ing every gated request would lock staff out
 * entirely, so the read falls back to the pre-migration shape and measures
 * idleness from the mint time instead.
 */
test('a session authenticates before the last_seen_at migration has run', async t => {
  const f = entranceFixture();
  t.after(() => f.db.close());
  // Deliberately the PRE-migration shape: no last_seen_at column.
  f.db.exec(`CREATE TABLE app_users (id TEXT, status TEXT);
    CREATE TABLE app_sessions (token_hash TEXT, user_id TEXT, created_at INTEGER, expires_at INTEGER);
    INSERT INTO app_users VALUES ('staff', 'Active');`);
  const token = 'pre-migration';
  const hash = await hashOf(token);
  const minted = Date.now();
  f.db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?, ?)').run(hash, 'staff', minted, minted + 3_600_000);
  // Any statement naming the missing column throws the way D1 does.
  const DB = {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        all: async () => {
          if (sql.includes('last_seen_at')) throw new Error('D1_ERROR: no such column: s.last_seen_at');
          return { results: await f.query(sql, params) };
        },
        run: async () => {
          if (sql.includes('last_seen_at')) throw new Error('D1_ERROR: no such column: last_seen_at');
          return f.db.prepare(sql).run(...params);
        },
      })
    })
  };
  const env = { DB, ASSETS: { fetch: async () => new Response('staff shell', { headers: { 'content-type': 'text/html' } }) } } as unknown as Parameters<typeof worker.fetch>[1];
  // It must authenticate, not 500.
  assert.equal((await worker.fetch(new Request('https://test/labs/reports', { headers: { cookie: `idofera_session=${token}` } }), env)).status, 200);
  // And a session minted long ago must still be refused, using the mint time.
  const stale = Date.now() - 3_600_000;
  f.db.prepare('DELETE FROM app_sessions').run();
  f.db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?, ?)').run(hash, 'staff', stale, Date.now() + 3_600_000);
  assert.equal((await worker.fetch(new Request('https://test/labs/reports', { headers: { cookie: `idofera_session=${token}` } }), env)).status, 302);
});

/**
 * Lock and Sign Out must stay TWO actions in the UI. They were one button
 * labelled "Sign Out / Lock Workspace" that only ever signed out, which quietly
 * promised a feature that did not exist and made a shared-terminal lock
 * impossible. Lock is one-tap; Sign Out is confirmed because it ends the
 * Cloudflare Access session too.
 */
test('Lock and Sign Out are separate, differently-confirmed actions', () => {
  const header = fs.readFileSync('src/components/common/Header.tsx', 'utf8');
  assert.match(header, /<span>Lock Workspace<\/span>/);
  assert.match(header, /<span>Sign Out<\/span>/);
  // The ambiguous combined label must never come back.
  assert.doesNotMatch(header, /<span>Sign Out \/ Lock Workspace<\/span>/);
  // Lock fires immediately; Sign Out opens a confirmation first.
  assert.match(header, /void lock\(\)/);
  assert.match(header, /setShowConfirmSignOut\(true\)/);
  assert.match(header, /isOpen=\{showConfirmSignOut\}/);
  // The confirmation must be honest about BOTH halves of sign-out, and must point
  // at Lock as the cheaper alternative.
  assert.match(header, /ends your session AND your Cloudflare Access login, so nobody else can open the workspace/);
  assert.match(header, /use Lock Workspace instead/);
  // Lock must be honest that it does NOT protect the terminal.
  assert.match(header, /Does NOT protect the terminal from the next person/);
  // Sign-out must be able to reach the team domain, and the team domain is
  // never hardcoded in the client.
  assert.match(header, /isOpen=\{showConfirmSignOut\}[\s\S]*?void logout\(\)/);
});

/**
 * Lock and Sign Out differ in EXACTLY ONE way, and the test asserts that way
 * precisely because the first implementation got it wrong: both ended the Access
 * session and both returned to the Mall, so staff had two buttons that did the
 * same thing. Under Access the app-session difference is invisible anyway, because
 * `authSession` re-mints a session from any valid Access identity.
 *
 * So: Lock is a SCREEN lock (leaves Access alone, zero friction to return) and
 * Sign Out is the security boundary (ends Access). Idle escalates to the full
 * exit, because nobody announced they were leaving.
 */
test('Lock and Sign Out differ in exactly one way: who ends the Access session', () => {
  const auth = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
  // CRLF-tolerant: the source is checked out with Windows line endings.
  const body = (name: string) => new RegExp(`const ${name} = async[\\s\\S]*?\\r?\\n  };\\r?\\n`).exec(auth)?.[0] || '';
  const lock = body('lock');
  const leave = body('endAccessAndLeave');
  const logout = body('logout');
  assert.ok(lock, 'lock must be defined');
  assert.ok(leave, 'endAccessAndLeave must be defined');
  assert.ok(logout, 'logout must be defined');

  // Lock: screen only. It must NOT resolve or navigate to the Access logout, and
  // must not touch the server at all — that is what makes returning free.
  assert.doesNotMatch(lock, /accessLogoutUrl/, 'lock must leave the Access session alone');
  assert.doesNotMatch(lock, /fetch\(/, 'lock must change nothing server-side');
  assert.doesNotMatch(lock, /\/api\/auth\/lock/, 'lock must not revoke anything server-side');
  assert.match(lock, /clearLocalSession\(\)/, 'lock must clear the local session state');
  assert.match(lock, /window\.location\.replace\('\/'\)/, 'lock must return to the Mall');

  // Sign-out: ends Access, and reuses the shared full exit.
  assert.match(leave, /await accessLogoutUrl\(\)/, 'the full exit must resolve the Access logout URL');
  assert.match(leave, /window\.location\.replace\(accessUrl \|\| '\/'\)/, 'the full exit must leave via Access, else the Mall');
  assert.match(logout, /await endAccessAndLeave\(\)/, 'sign-out must take the full exit');
  assert.match(logout, /\/api\/auth\/logout/, 'sign-out must also destroy the app session');

  // Both leave the workspace; neither may return to /labs, or the SSO bootstrap
  // hands the session straight back.
  assert.doesNotMatch(lock, /replace\('\/labs'\)/);
  assert.doesNotMatch(leave, /replace\('\/labs'\)/);
  // The Access-recovery redirect must survive: when Access redirects the session
  // probe, navigating is the only way back into the IdP flow.
  assert.match(auth, /response\.redirected && !response\.url\.startsWith\(window\.location\.origin\)[\s\S]*?window\.location\.replace\('\/labs'\)/);
});

/**
 * Idle must escalate to the full exit, not reuse the screen lock. A screen-only
 * idle would be decorative: the session expires server-side, the client wipes the
 * screen, and the next 3-second cart hold walks the next person straight back in.
 */
test('idle signs out rather than screen-locking, and warns first', () => {
  const auth = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
  assert.match(auth, /export const IDLE_LOCK_MS = 30 \* 60 \* 1000;/);
  assert.match(auth, /export const IDLE_WARNING_MS = 60 \* 1000;/);
  // Both idle triggers take the full exit.
  assert.match(auth, /lockTimer = window\.setTimeout\(\(\) => \{ void endAccessAndLeave\(\); \}, IDLE_LOCK_MS\)/);
  assert.match(auth, /if \(active && !user && !entranceAllowed && !accessEmail\) \{\s*await endAccessAndLeave\(\);\s*\}/);
  // And neither may call the screen lock.
  assert.doesNotMatch(auth, /lock\(\{ idle: true \}\)/);
  // The warning precedes the exit, so nobody loses a form without notice.
  assert.ok(auth.indexOf('IDLE_LOCK_MS - IDLE_WARNING_MS') < auth.indexOf('void endAccessAndLeave()'));
  assert.match(auth, /The workspace will sign you out in one minute/);
  // Activity resets both timers.
  for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus']) {
    assert.ok(auth.includes(`'${event}'`), `idle timers must reset on ${event}`);
  }
});

/**
 * Lock and sign-out are genuinely DIFFERENT actions, and the UI used to offer one
 * button labelled "Sign Out / Lock Workspace" that only ever signed out.
 *
 * Lock must leave the session usable — that is the whole point, an operator
 * stepping away should not need a new OTP — while still destroying the step-up
 * proof, so a terminal left unattended cannot change users, roles or passwords.
 */
test('lock keeps the session but revokes the step-up proof; sign-out ends both', async t => {
  const { f, env, seed } = sessionFixture();
  t.after(() => f.db.close());
  const token = 'lock-session';
  const minted = Date.now();
  seed(await hashOf(token), minted, minted + 3_600_000, minted);

  const stepUp = await issueStepUp(f.query, 'staff');
  const stepUpPart = `${STEP_UP_COOKIE}=${stepUp}`;
  assert.equal(await hasStepUp(stepUpPart, 'staff', f.query), true, 'a step-up exists before the lock');

  const locked = await worker.fetch(new Request('https://test/api/auth/lock', { method: 'POST', headers: { cookie: `idofera_session=${token}; ${stepUpPart}` } }), env());
  assert.equal(locked.status, 200);
  assert.equal(await hasStepUp(stepUpPart, 'staff', f.query), false, 'lock revokes the step-up proof');
  assert.equal((f.db.prepare('SELECT token_hash FROM app_sessions WHERE user_id = ?').all('staff') as unknown as unknown[]).length, 1, 'lock must NOT delete the session');
  // And the session still opens the workspace, so unlocking is immediate.
  assert.equal((await worker.fetch(new Request('https://test/labs/reports', { headers: { cookie: `idofera_session=${token}` } }), env())).status, 200);

  // Sign-out, by contrast, ends the session too.
  const out = await worker.fetch(new Request('https://test/api/auth/logout', { method: 'POST', headers: { cookie: `idofera_session=${token}` } }), env());
  assert.equal(out.status, 200);
  assert.equal((f.db.prepare('SELECT token_hash FROM app_sessions WHERE user_id = ?').all('staff') as unknown as unknown[]).length, 0, 'sign-out deletes the session');
});

/**
 * The idle window is the automatic version of the same lock: a terminal that is
 * simply abandoned — nobody pressed "Lock" — must stop authorizing private APIs
 * even though the absolute seven-day expiry has not passed.
 */
test('a session idle past CF_SESSION_IDLE_SECONDS stops authorizing', async t => {
  const { f, env, seed } = sessionFixture();
  t.after(() => f.db.close());
  const token = 'idle-session';
  // Minted an hour ago and never seen since: well inside the 7-day expiry.
  const minted = Date.now() - 3_600_000;
  const hash = await hashOf(token);
  seed(hash, minted, Date.now() + 7 * 86_400_000, minted);
  const cookie = `idofera_session=${token}`;

  // The default 30-minute window rejects it and the staff page bounces.
  assert.equal((await worker.fetch(new Request('https://test/labs/reports', { headers: { cookie } }), env())).status, 302);
  // A generous window accepts it AND refreshes last_seen_at, so idleness is
  // measured from this request rather than from the mint.
  const relaxed = env({ CF_SESSION_IDLE_SECONDS: '86400' });
  assert.equal((await worker.fetch(new Request('https://test/labs/reports', { headers: { cookie } }), relaxed)).status, 200);
  const row = f.db.prepare('SELECT last_seen_at FROM app_sessions WHERE token_hash = ?').get(hash) as unknown as { last_seen_at: number };
  assert.ok(row.last_seen_at > minted, 'an accepted request refreshes last_seen_at');
});

/**
 * Sign-out is incomplete while Access still holds its own session — a 3-second
 * cart hold would walk straight back in with no OTP. The team domain lives only
 * on the server, so the client asks for the URL; a deployment with the gate off
 * has no Access session to end and must say so rather than inventing a URL.
 */
test('the Access logout URL is offered only when the gate is configured', async t => {
  const f = entranceFixture();
  t.after(() => f.db.close());
  const DB = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), run: async () => ({}) }) }) };
  const read = async (extra: Record<string, unknown>) => {
    const env = { DB, CF_ACCESS_TEAM_DOMAIN: '', ASSETS: { fetch: async () => new Response('', { headers: { 'content-type': 'text/html' } }) }, ...extra } as unknown as Parameters<typeof worker.fetch>[1];
    return await (await worker.fetch(new Request('https://test/api/auth/access-logout-url'), env)).json() as { url: string | null };
  };

  assert.deepEqual(await read({}), { url: null }, 'gate off (local development) has nothing to end');
  assert.deepEqual(await read({ CF_ACCESS_SSO: 'false', CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com' }), { url: null }, 'SSO disabled means no Access session');
  const live = await read({ CF_ACCESS_SSO: 'true', CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/' });
  assert.match(live.url || '', /^https:\/\/team\.cloudflareaccess\.com\/cdn-cgi\/access\/logout\?returnTo=/);
  assert.match(decodeURIComponent(live.url || ''), /returnTo=https:\/\/test\/?$/, 'returns the operator to this origin (the Mall)');
});

/**
 * The collapsed readiness panel states the score, so a wrong fraction is a
 * safety bug, not a cosmetic one. `mallReadiness` currently reports 14 checks
 * (the passing case is asserted server-side in mall-safety.test.ts), and a
 * missing or empty payload must read as unknown — never as a healthy store.
 */
test('readiness scoring reports the real check count and never claims health it cannot prove', () => {
  const NAMES = ['stockTrigger', 'schemaObjects', 'schema', 'database', 'listingFields', 'scheduler', 'notifications', 'webhookDelivery', 'fulfilmentQueue', 'bank', 'pickup', 'webhook', 'checkoutEnabled', 'imageStorage'];
  assert.equal(NAMES.length, 14, 'the denominator is derived, so a name list this long implies 14 checks');

  const allPass = Object.fromEntries(NAMES.map((name) => [name, true]));
  assert.deepEqual(mallReadinessSummary(allPass), { ready: true, passing: 14, total: 14, label: 'Ready (14/14)' });

  // Nine of fourteen passing: the header must say Not Ready and print the
  // partial score, never a bare word that hides how much is broken.
  const nineOfFourteen = Object.fromEntries(NAMES.map((name, index) => [name, index < 9]));
  assert.deepEqual(mallReadinessSummary(nineOfFourteen), { ready: false, passing: 9, total: 14, label: 'Not Ready (9/14)' });

  const allFail = Object.fromEntries(NAMES.map((name) => [name, false]));
  assert.deepEqual(mallReadinessSummary(allFail), { ready: false, passing: 0, total: 14, label: 'Not Ready (0/14)' });

  // Unknown is not healthy: a failed fetch has no payload, and the server's own
  // `ready` flag is vacuously true for {} (`[].every(Boolean)`), so trusting it
  // would report a broken store as a passing one.
  assert.deepEqual(mallReadinessSummary(null), { ready: false, passing: 0, total: 0, label: 'Unavailable' });
  assert.deepEqual(mallReadinessSummary(undefined), { ready: false, passing: 0, total: 0, label: 'Unavailable' });
  assert.deepEqual(mallReadinessSummary({}), { ready: false, passing: 0, total: 0, label: 'Unavailable' });

  // A non-boolean must not score as a passing check: strict equality, not
  // truthiness, so a malformed payload degrades to Not Ready rather than Ready.
  assert.deepEqual(mallReadinessSummary({ a: 1, b: 'yes', c: true } as unknown as Record<string, boolean>), { ready: false, passing: 1, total: 3, label: 'Not Ready (1/3)' });
});

/**
 * Canon invariants (docs/05-canon-migration.md). Guards the `idofera` canon
 * against future ETL drift by dry-loading the generated relational import into an
 * in-memory store and asserting the properties the cutover verified live:
 *   - no clearance / non-inventory products in the catalogue,
 *   - no orphan sale/purchase line items,
 *   - no base64 images,
 *   - a stable sales money total.
 *
 * Skips (does not fail) when the import artifact is absent, so a checkout without
 * `backups/` still passes. Regenerate it with:
 *   npx tsx scripts/etl/dump.ts --source=backups/<idofera-d1-export>.sql --full-refresh
 */
test('canon import holds the clearance / orphan / base64 / money invariants', () => {
  const file = 'backups/idofera-relational-import.sql';
  if (!fs.existsSync(file)) {
    console.log(`skipped: ${file} not present (run etl:dump to generate it)`);
    return;
  }
  const raw = fs.readFileSync(file, 'utf8');
  // One statement per line, EXCEPT when a payload embeds a raw newline; track
  // single-quote parity so a split statement is reassembled.
  const statements: string[] = [];
  let buf = '';
  let inString = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!buf && (trimmed.length === 0 || trimmed.startsWith('--'))) continue;
    buf = buf ? `${buf}\n${line}` : line;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "'") continue;
      if (inString && line[i + 1] === "'") { i++; continue; }
      inString = !inString;
    }
    if (!inString) { const done = buf.trim(); if (done && !done.startsWith('--')) statements.push(done); buf = ''; }
  }
  if (buf.trim()) statements.push(buf.trim());

  const db = new DatabaseSync(':memory:');
  try {
    ensureRelationalSchemaNode(db);
    db.exec('BEGIN;');
    for (const sql of statements) db.exec(sql);
    db.exec('COMMIT;');

    const one = (sql: string) => db.prepare(sql).get() as any;
    const n = (sql: string) => Number(one(sql)?.n || 0);

    assert.equal(
      n("SELECT COUNT(*) AS n FROM products WHERE id LIKE 'clearance-%' OR UPPER(sku) = 'CLEARANCE'"),
      0,
      'clearance / non-inventory items must never be catalogue products',
    );
    assert.equal(
      n('SELECT COUNT(*) AS n FROM sale_items WHERE product_id IS NOT NULL AND product_id != \'\' AND product_id NOT IN (SELECT id FROM products)'),
      0,
      'no orphan sale_items',
    );
    assert.equal(
      n('SELECT COUNT(*) AS n FROM purchase_items WHERE product_id IS NOT NULL AND product_id != \'\' AND product_id NOT IN (SELECT id FROM products)'),
      0,
      'no orphan purchase_items',
    );
    assert.equal(
      n('SELECT COUNT(*) AS n FROM products WHERE images_json LIKE \'%data:%\''),
      0,
      'base64 photos must never enter relational storage',
    );
    assert.ok(n('SELECT COUNT(*) AS n FROM sales') > 0, 'the canon carries sales');
    assert.ok(n('SELECT COALESCE(SUM(total_kobo),0) AS n FROM sales') > 0, 'the canon carries a positive sales total');
  } finally {
    db.close();
  }
});
