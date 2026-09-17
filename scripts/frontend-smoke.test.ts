import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRoute } from '../src/hooks/useRoute.ts';
import { validateBuyer } from '../src/mall-site/useBuyerForm.ts';

test('public routes preserve category, product and search parameters', () => {
  assert.deepEqual(parseRoute('/category/Bottles', ''), { surface: 'mall', page: 'category', param: 'Bottles' });
  assert.deepEqual(parseRoute('/product/prod-1', ''), { surface: 'mall', page: 'product', param: 'prod-1' });
  assert.deepEqual(parseRoute('/search', '?q=plain+bottle'), { surface: 'mall', page: 'search', param: 'plain bottle' });
});

test('staff routes are deep-linkable', () => {
  assert.deepEqual(parseRoute('/app/pos', ''), { surface: 'staff', staffPage: 'pos' });
  assert.deepEqual(parseRoute('/app/reports', ''), { surface: 'staff', staffPage: 'reports' });
});

test('checkout validation requires a name and plausible phone', () => {
  assert.equal(validateBuyer('', '08031234567'), 'Please enter your name.');
  assert.equal(validateBuyer('Ada', '123'), 'Enter a valid phone number.');
  assert.equal(validateBuyer('Ada', '0803 123 4567'), '');
});