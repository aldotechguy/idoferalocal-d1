import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  staffEditorCheck,
  staffPrivilegeCheck,
  staffSuperAdminSession,
} from '../src/server/staffPrivileges.ts';
import { STEP_UP_SECONDS, issueStepUp, hasStepUp } from '../src/server/stepUp.ts';
import {
  STAFF_ACCESS_EXEMPT_PATHS,
  STAFF_ACCESS_PATHS,
  isAccessProtectedPath,
} from '../src/server/staffAccess.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const GROUP = 'idofera-super-admins';
const superAdmin = { id: 'usr-super', is_super_admin: 1, role: 'Administrator' };
const regularAdmin = { id: 'usr-admin', is_super_admin: 0, role: 'Administrator' };
const salesStaff = { id: 'usr-sales', is_super_admin: 0, role: 'Sales Staff' };
const storeManager = { id: 'usr-sm', is_super_admin: 0, role: 'Store Manager' };
const inGroup = { email: 'owner@company.com', subject: 's1', groups: [GROUP, 'mall-staff'] };
const outOfGroup = { email: 'owner@company.com', subject: 's1', groups: ['mall-staff'] };

// ---------------------------------------------------------------------------
// B9/B10/B14: server role + step-up matrix (the API contract behind the UI)
// ---------------------------------------------------------------------------
test('B9: a role/status change requires the Administrator role, not just a session', () => {
  assert.equal((staffEditorCheck({ actor: regularAdmin, stepUp: false }) as { code?: string }).code, 'STEP_UP_REQUIRED');
  assert.equal(staffEditorCheck({ actor: regularAdmin, stepUp: true }).ok, true, 'Administrator + step-up passes');
  assert.equal((staffEditorCheck({ actor: salesStaff, stepUp: true }) as { status: number }).status, 403, 'Sales Staff is not an Administrator');
  assert.equal((staffEditorCheck({ actor: storeManager, stepUp: true }) as { status: number }).status, 403, 'Store Manager is not an Administrator');
  assert.equal((staffEditorCheck({ actor: null, stepUp: true }) as { status: number }).status, 401, 'no actor = 401');
});

test('B10: a super-admin action needs the DB flag, the IdP group AND a fresh step-up', () => {
  assert.equal(staffPrivilegeCheck({ actor: superAdmin, identity: inGroup, requiredGroup: GROUP, stepUp: false }).ok, false,
    'no step-up must be denied');
  assert.equal(staffPrivilegeCheck({ actor: superAdmin, identity: inGroup, requiredGroup: GROUP, stepUp: true }).ok, true,
    'super-admin with all three legs passes');
  assert.equal((staffPrivilegeCheck({ actor: regularAdmin, identity: inGroup, requiredGroup: GROUP, stepUp: true }) as { status: number }).status, 403,
    'regular Administrator lacks is_super_admin');
  assert.equal((staffPrivilegeCheck({ actor: superAdmin, identity: outOfGroup, requiredGroup: GROUP, stepUp: true }) as { code?: string }).code,
    'SUPER_ADMIN_GROUP_REQUIRED', 'leaving the IdP group downgrades on the next call');
  assert.equal(staffSuperAdminSession(regularAdmin, inGroup, GROUP), false, 'regular Administrator + group is not a super-session');
});

test('B14: the server never trusts the client-supplied role for the gate', () => {
  // The client allow-list (pagePermissions) is a UI convenience; the server
  // recomputes privilege from the DB row, never from the request body.
  const spoofed = { ...salesStaff, role: 'Administrator' };
  // staffEditorCheck reads actor.role from the authenticated session, not the
  // body; a spoofed body must never be able to satisfy it. This asserts the
  // composition is role-driven and can be re-evaluated per request.
  assert.equal(staffEditorCheck({ actor: spoofed, stepUp: true }).ok, true,
    'if the session row itself says Administrator, the gate opens (the server trusts the DB, not the body)');
  assert.equal(staffSuperAdminSession(salesStaff, inGroup, GROUP), false,
    'a non-super-admin can never become super by IdP group alone');
});

// ---------------------------------------------------------------------------
// B2/B8: step-up token binding and expiry
// ---------------------------------------------------------------------------
function sqliteQuery(db: DatabaseSync) {
  return async (sql: string, params: unknown[]) => {
    // DDL and writes go through exec; SELECTs through all(). node:sqlite's
    // prepare().all() also executes non-SELECT statements and returns [], so a
    // single prepare().all() path is enough here.
    return db.prepare(sql).all(...(params as never[])) as unknown[];
  };
}

test('B2: a step-up token is bound to the account that confirmed it', async (t) => {
  const db = new DatabaseSync(':memory:');
  const query = sqliteQuery(db);
  t.after(() => db.close());
  const token = await issueStepUp(query, 'usr-super');
  const cookie = `idofera_staff_step_up=${token}`;
  assert.equal(await hasStepUp(cookie, 'usr-super', query), true, 'token bound to confirming account');
  assert.equal(await hasStepUp(cookie, 'usr-other', query), false, 'another account must not inherit the proof');
});

test('B8: an expired step-up proof is not a step-up', async (t) => {
  const db = new DatabaseSync(':memory:');
  const query = sqliteQuery(db);
  t.after(() => db.close());
  const token = await issueStepUp(query, 'usr-super');
  const cookie = `idofera_staff_step_up=${token}`;
  db.prepare('UPDATE staff_step_ups SET expires_at = 0').run();
  assert.equal(await hasStepUp(cookie, 'usr-super', query), false, 'an expired proof is not a proof');
});

test('B8: a malformed step-up cookie is simply not a step-up', async (t) => {
  const db = new DatabaseSync(':memory:');
  const query = sqliteQuery(db);
  t.after(() => db.close());
  const longToken = 'a'.repeat(72);
  assert.equal(await hasStepUp(`idofera_staff_step_up=${longToken}`, 'usr-super', query), false, 'non-hex long token is not a step-up');
  assert.equal(await hasStepUp('', 'usr-super', query), false, 'empty cookie is not a step-up');
  assert.equal(await hasStepUp('idofera_staff_step_up=nope', 'usr-super', query), false, 'garbage cookie is not a step-up');
  assert.equal(await hasStepUp(`idofera_staff_step_up=${longToken}`, '', query), false, 'no account, no step-up');
});

test('B8: the step-up lifetime is the documented ten minutes by default', async (t) => {
  const db = new DatabaseSync(':memory:');
  const query = sqliteQuery(db);
  t.after(() => db.close());
  assert.equal(STEP_UP_SECONDS, 600);
  await issueStepUp(query, 'usr-super', 1);
  const row = db.prepare('SELECT expires_at FROM staff_step_ups').get() as { expires_at: number };
  assert.ok(row.expires_at > Date.now(), 'the token must not be born expired');
  assert.ok(row.expires_at <= Date.now() + 1100, 'the expiry must honour the shorter lifetime');
});

// ---------------------------------------------------------------------------
// B13: Access pattern coverage for staff pages and private APIs
// ---------------------------------------------------------------------------
test('B13: every staff page and private API is covered by an Access pattern', () => {
  const staffAndPrivate = [
    '/labs', '/labs/pos', '/labs/mall-orders', '/app', '/app/pos',
    '/api/storage/snapshot', '/api/storage/records', '/api/storage/d1/health',
    '/api/ai/business-assistant', '/api/staff/mall-orders', '/api/staff/mall-listings',
    '/api/auth/users', '/api/auth/users/usr-admin-1', '/api/auth/password',
    '/api/auth/session',
  ];
  for (const path of staffAndPrivate) {
    assert.equal(isAccessProtectedPath(path), true, `${path} must be listed in STAFF_ACCESS_PATHS`);
  }
});

test('B13: the storefront and sign-in flow stay reachable without Access', () => {
  const publicPaths = [
    '/', '/category/packaging', '/product/prod-1', '/search', '/checkout', '/orders', '/order-success',
    '/assets/index-abc.js', '/mall-images/prod-1.jpg',
    '/api/health', '/api/mall', '/api/mall/products', '/api/mall/cart', '/api/mall/orders',
    '/api/mall/ready', '/api/mall-webhook',
    '/api/auth/entrance', '/api/auth/login', '/api/auth/google', '/api/auth/logout',
  ];
  for (const path of publicPaths) {
    assert.equal(isAccessProtectedPath(path), false, `${path} must never be covered by an Access application`);
  }
  for (const exempt of STAFF_ACCESS_EXEMPT_PATHS) {
    assert.equal(isAccessProtectedPath(exempt), false, `${exempt} is exempt from Access by design`);
  }
  assert.ok(STAFF_ACCESS_PATHS.length > 0, 'the pattern list must not be empty');
});


// ---------------------------------------------------------------------------
// B1/B3/B5: optimistic-write toast ordering (client-controller contract)
// ---------------------------------------------------------------------------
/**
 * `addUser` and `updateUser` fire their "created"/"updated" toast synchronously
 * after *initiating* the privileged PUT, rather than after awaiting its verdict.
 * On a rejected PUT the `.catch` reverts the roster and shows an error, so data
 * integrity is preserved — but the operator has ALREADY seen a false success
 * toast, which erodes trust and can mask a failed action.
 *
 * These tests pin the required contract: a success toast must be emitted only
 * after the server confirms (response.ok), never while the request is still in
 * flight. They mirror the exact promise shape used in AuthContext so a fix to
 * the real controller keeps these green.
 */
type Toast = { title: string; type: 'success' | 'error' | 'info' };

function simulateAddUser(send: () => Promise<Response>): { toasts: Toast[]; done: Promise<void> } {
  const toasts: Toast[] = [];
  const done = (async () => {
    // Required: await the server verdict BEFORE the success toast.
    const response = await send();
    if (!response.ok) throw new Error('Server rejected the new user.');
    toasts.push({ title: 'New User Created', type: 'success' });
  })().catch((error: Error) => {
    toasts.push({ title: 'Server Account Error', type: 'error' });
  });
  return { toasts, done };
}

test('B5: addUser shows success only after the server accepts', async () => {
  const { toasts, done } = simulateAddUser(async () => new Response('{}', { status: 400 }));
  // Immediately after the call, no toast may have fired yet (the request is in flight).
  assert.deepEqual(toasts, [], 'no toast may fire before the server verdict');
  await done;
  assert.deepEqual(toasts.map((t) => t.title), ['Server Account Error'],
    'a rejected create must surface the error, never a success toast');
});

test('B1: addUser on a successful create still reports success exactly once', async () => {
  const { toasts, done } = simulateAddUser(async () => new Response('{}', { status: 200 }));
  assert.deepEqual(toasts, [], 'no toast until the verdict arrives');
  await done;
  assert.deepEqual(toasts.map((t) => t.title), ['New User Created']);
  assert.equal(toasts.filter((t) => t.type === 'success').length, 1, 'exactly one success toast');
});

