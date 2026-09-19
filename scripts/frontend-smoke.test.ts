import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseRoute } from '../src/hooks/useRoute.ts';
import { computeMenuStyle, PORTAL_DROPDOWN_Z } from '../src/components/common/PortalDropdown.tsx';
import { validateBuyer } from '../src/mall-site/useBuyerForm.ts';
import { mallDeliveryFeeKobo, mallDeliveryZone } from '../src/shared/mallDelivery.ts';
import { mallStockLabel } from '../src/shared/mallProductPresentation.ts';
import { mallClient } from '../src/services/mallClient.ts';
import { createMallSearchMatcher, mallOneTypo } from '../src/shared/mallSearch.ts';
import worker from '../sites-worker.ts';
import { createStaffCartHold, STAFF_CART_HOLD_MS } from '../src/hooks/useStaffCartHold.ts';
import { DatabaseSync } from 'node:sqlite';
import { issueEntrance, hasEntrance, revokeEntrance, entranceCookie, isStaffPage, isPrivateApi } from '../src/server/staffEntrance.ts';

function entranceFixture() {
  const db = new DatabaseSync(':memory:');
  const query = async (sql: string, params: any[]) => db.prepare(sql).all(...params);
  const DB = { prepare: (sql: string) => ({ bind: (...params: any[]) => ({ all: async () => ({ results: await query(sql, params) }) }) }) };
  return { db, query, DB };
}

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
  for (const path of ['/api/storage/snapshot', '/api/storage/records', '/api/ai/business-assistant', '/api/staff/mall-orders']) {
    assert.equal((await worker.fetch(new Request(`https://test${path}`, { headers: { cookie } }), env)).status, 401);
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
    CREATE TABLE app_sessions (token_hash TEXT, user_id TEXT, expires_at INTEGER);
    INSERT INTO app_users VALUES ('staff', 'Active');`);
  const token = 'test-session';
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
  f.db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?)').run(hash, 'staff', Date.now() + 60000);
  const DB = { prepare: (sql: string) => ({ bind: (...params: any[]) => ({
    all: async () => ({ results: await f.query(sql, params) }),
    run: async () => f.db.prepare(sql).run(...params),
  }) }) };
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

test('mall header exposes accessible cancellable live search without staff data', () => {
  const source = fs.readFileSync('src/mall-site/MallHeaderSearch.tsx', 'utf8');
  const header = fs.readFileSync('src/mall-site/MallHeader.tsx', 'utf8');
  assert.match(header, /<MallHeaderSearch/);
  for (const pattern of [/PortalDropdown/, /role="combobox"/, /role="listbox"/, /role="option"/, /aria-activedescendant/, /ArrowDown/, /ArrowUp/, /Escape/, /event.metaKey/, /controller.abort\(\)/, /!controller.signal.aborted/, /window.clearTimeout/, /result\?\.query === cleanQuery/, /View all results/, /Retry suggestions/]) assert.match(source, pattern);
  assert.doesNotMatch(source, /useApp|AppContext|useAuth|\/api\/staff/);
});

test('Mall cards always show catalog stock independently of purchase eligibility', () => {
  assert.equal(mallStockLabel(250), '250 left');
  assert.equal(mallStockLabel(1000), '1,000 left');
  assert.equal(mallStockLabel(11), '11 left');
  assert.equal(mallStockLabel(10), 'Only 10 left');
  assert.equal(mallStockLabel(1), 'Only 1 left');
  assert.equal(mallStockLabel(0), 'Out of stock');
  const card = fs.readFileSync('src/mall-site/MallProductCard.tsx', 'utf8');
  assert.match(card, /\{product.unit\}.*\{mallStockLabel\(product.stock\)\}/);
  assert.doesNotMatch(card, /product.available && product.stock <= 10/);
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

test('checkout validation requires a name and plausible phone', () => {
  assert.equal(validateBuyer('', '08031234567'), 'Please enter your name.');
  assert.equal(validateBuyer('Ada', '123'), 'Enter a valid phone number.');
  assert.equal(validateBuyer('Ada', '0803 123 4567'), '');
});

test('fixed delivery zones expose canonical fees', () => {
  assert.equal(mallDeliveryFeeKobo('pickup'), 0);
  assert.equal(mallDeliveryFeeKobo('uyo_central'), 150000);
  assert.equal(mallDeliveryFeeKobo('uyo_outer'), 250000);
  assert.equal(mallDeliveryFeeKobo('other'), null);
  assert.equal(mallDeliveryZone('invalid'), 'pickup');
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
});

test('checkout customer card does not scroll over the payment method fieldset', () => {
  const checkout = fs.readFileSync('src/mall-site/MallCheckout.tsx', 'utf8');
  assert.match(checkout, /Payment method/);
  assert.doesNotMatch(checkout, /lg:sticky/);
});