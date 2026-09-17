import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseRoute } from '../src/hooks/useRoute.ts';
import { validateBuyer } from '../src/mall-site/useBuyerForm.ts';
import { mallDeliveryFeeKobo, mallDeliveryZone } from '../src/shared/mallDelivery.ts';

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