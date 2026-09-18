import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseRoute } from '../src/hooks/useRoute.ts';
import { computeMenuStyle, PORTAL_DROPDOWN_Z } from '../src/components/common/PortalDropdown.tsx';
import { validateBuyer } from '../src/mall-site/useBuyerForm.ts';
import { mallDeliveryFeeKobo, mallDeliveryZone } from '../src/shared/mallDelivery.ts';
import { mallStockLabel } from '../src/shared/mallProductPresentation.ts';

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