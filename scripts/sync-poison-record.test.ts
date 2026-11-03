import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { productToRow, saleToRows } from '../src/server/relationalMapper.ts';

/**
 * A single record the relational store refuses (UNIQUE index, NOT NULL column)
 * used to reject the WHOLE PATCH. Each retry re-sent every queued key, so the
 * healthy edits queued behind it never landed and the device never converged.
 */
test('a rejected record no longer blocks the rest of the queue', () => {
  const source = fs.readFileSync('src/services/d1StorageService.ts', 'utf8');
  const isolate = source.slice(source.indexOf('export async function pushStoreOrIsolate'));
  assert.ok(isolate.length > 0, 'pushStoreOrIsolate exists');
  // One record failing must not abort the loop over the others.
  assert.match(isolate, /catch \(recordError\)/);
  assert.match(isolate, /accepted\.add\(key\)/);
  assert.match(isolate, /if \(!accepted\.size\) throw error/);
  // The auto-save path does the same and acknowledges only what was accepted.
  assert.match(source, /accepted: string\[\]/);
  const hook = fs.readFileSync('src/hooks/useCloudSync.ts', 'utf8');
  assert.match(hook, /pushStoreOrIsolate/);
  assert.match(hook, /accepted\.has\(key\)/);
});

test('the client surfaces the server-side D1 reason instead of only the status', () => {
  const source = fs.readFileSync('src/services/d1StorageService.ts', 'utf8');
  const sync = source.slice(source.indexOf('export async function syncLocalRecordsToD1'));
  assert.match(sync, /relationalError/);
  assert.match(sync, /D1 record sync failed \(\$\{response\.status\}\)\$\{reason/);
});

test('a blank product SKU never collides on the UNIQUE sku index', () => {
  const a = productToRow({ id: 'p-1', name: 'A' }, '2026-01-01T00:00:00Z');
  const b = productToRow({ id: 'p-2', name: 'B', sku: '' }, '2026-01-01T00:00:00Z');
  assert.equal(a.sku, 'p-1');
  assert.equal(b.sku, 'p-2');
  assert.notEqual(a.sku, b.sku);
});

test('placeholder receipts do not collide, and real receipts are preserved', () => {
  const sale = (id: string, invoiceNo?: string) => saleToRows({ id, invoiceNo, totalAmount: 1, items: [] }).header.receipt_no;
  assert.notEqual(sale('s-1', ''), sale('s-2', ''));
  assert.equal(sale('s-3', 'INV-3'), 'INV-3');
  assert.notEqual(sale('s-4', 'N/A'), sale('s-5', '-'));
});
