import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNativeMallEngineAvailable,
  validateOrderTransition,
  calculateAmountDueKobo,
  verifyOrderTotals,
} from '../src/native-bridge';

test('native mall engine is built and active when rollout is enabled', () => {
  if (process.env.IDOFERA_NATIVE_ENABLED === 'true') {
    assert.equal(isNativeMallEngineAvailable(), true, 'Native mall engine addon must be active for the opt-in run');
  }
});

test('order state machine transitions are strictly verified', async () => {
  // Valid pipeline
  assert.equal((await validateOrderTransition('pending', 'confirmed')).allowed, true);
  assert.equal((await validateOrderTransition('confirmed', 'processing')).allowed, true);
  assert.equal((await validateOrderTransition('processing', 'packed')).allowed, true);
  assert.equal((await validateOrderTransition('processing', 'completed')).allowed, true);
  assert.equal((await validateOrderTransition('packed', 'out_for_delivery')).allowed, true);
  assert.equal((await validateOrderTransition('out_for_delivery', 'completed')).allowed, true);

  // Idempotent no-op
  const idempotent = await validateOrderTransition('confirmed', 'confirmed');
  assert.equal(idempotent.allowed, true);
  assert.equal(idempotent.isIdempotent, true);

  // Illegal transitions (strictly rejected)
  const illegalJump = await validateOrderTransition('pending', 'completed');
  assert.equal(illegalJump.allowed, false);
  assert.ok(illegalJump.errorMessage?.includes('cannot move to completed'));

  const illegalRevert = await validateOrderTransition('completed', 'pending');
  assert.equal(illegalRevert.allowed, false);

  const illegalCancellation = await validateOrderTransition('completed', 'cancelled');
  assert.equal(illegalCancellation.allowed, false);

  console.log('Order state machine transition rules verified via native Rust engine!');
});

test('calculateAmountDueKobo handles normal, overpaid, and terminal states', async () => {
  // Normal outstanding
  assert.equal(await calculateAmountDueKobo(50000, 20000, 'processing'), 30000);
  // Fully paid
  assert.equal(await calculateAmountDueKobo(50000, 50000, 'processing'), 0);
  // Overpaid clamp
  assert.equal(await calculateAmountDueKobo(50000, 70000, 'processing'), 0);
  // Cancelled or Refunded -> 0 due
  assert.equal(await calculateAmountDueKobo(50000, 10000, 'cancelled'), 0);
  assert.equal(await calculateAmountDueKobo(50000, 10000, 'refunded'), 0);

  console.log('Amount due calculations verified in exact integer kobo!');
});

test('verifyOrderTotals checks arithmetic invariants', async () => {
  // 10000 subtotal - 1000 discount + 1500 delivery = 10500 total
  assert.equal(await verifyOrderTotals(10000, 1000, 1500, 10500), true);
  // Corrupted total
  assert.equal(await verifyOrderTotals(10000, 1000, 1500, 10501), false);
  // Negative value rejected
  assert.equal(await verifyOrderTotals(10000, -500, 1500, 12000), false);

  console.log('Order total invariants verified!');
});
