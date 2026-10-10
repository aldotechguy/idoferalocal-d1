import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  staffEditorCheck,
  staffPrivilegeCheck,
  staffSuperAdminSession,
} from '../src/server/staffPrivileges.ts';
import { STEP_UP_SECONDS, issueStepUp, hasStepUp, revokeStepUp, revokeStepUpForUser } from '../src/server/stepUp.ts';

const GROUP = 'idofera-super-admins';
const superAdmin = { id: 'usr-super', is_super_admin: 1, role: 'Administrator' };
const regularAdmin = { id: 'usr-admin', is_super_admin: 0, role: 'Administrator' };
const salesStaff = { id: 'usr-sales', is_super_admin: 0, role: 'Sales Staff' };
const inGroup = { email: 'owner@company.com', subject: 's1', groups: [GROUP, 'mall-staff'] };
const outOfGroup = { email: 'owner@company.com', subject: 's1', groups: ['mall-staff'] };

test('privilege is never granted by the IdP alone', () => {
  // The IdP says "super admin"; the roster says otherwise. The roster wins.
  assert.equal(staffSuperAdminSession(regularAdmin, inGroup, GROUP), false);
  assert.equal(staffSuperAdminSession(salesStaff, inGroup, GROUP), false);
  assert.equal(staffSuperAdminSession(null, inGroup, GROUP), false);
  assert.equal(staffPrivilegeCheck({ actor: regularAdmin, identity: inGroup, requiredGroup: GROUP, stepUp: true }).ok, false);
  assert.equal(
    (staffPrivilegeCheck({ actor: regularAdmin, identity: inGroup, requiredGroup: GROUP, stepUp: true }) as { status: number }).status,
    403,
  );
});

test('the configured IdP group is part of the super-admin gate', () => {
  assert.equal(staffSuperAdminSession(superAdmin, inGroup, GROUP), true);
  assert.equal(staffSuperAdminSession(superAdmin, outOfGroup, GROUP), false);
  assert.equal(staffSuperAdminSession(superAdmin, null, GROUP), false, 'no verified identity means no group claim');

  const denied = staffPrivilegeCheck({ actor: superAdmin, identity: outOfGroup, requiredGroup: GROUP, stepUp: true });
  assert.equal(denied.ok, false);
  assert.equal((denied as { code?: string }).code, 'SUPER_ADMIN_GROUP_REQUIRED');

  // Leaving the group requirement unset disables it (an IdP with no group
  // claims must not lock the installation out of user administration).
  assert.equal(staffSuperAdminSession(superAdmin, null, undefined), true);
  assert.equal(staffPrivilegeCheck({ actor: superAdmin, identity: null, stepUp: true }).ok, true);
});

test('a fresh step-up is required for every privileged action', () => {
  const withoutStepUp = staffPrivilegeCheck({ actor: superAdmin, identity: inGroup, requiredGroup: GROUP, stepUp: false });
  assert.equal(withoutStepUp.ok, false);
  assert.equal((withoutStepUp as { code?: string }).code, 'STEP_UP_REQUIRED');
  assert.equal((withoutStepUp as { status: number }).status, 403);
  assert.equal(staffPrivilegeCheck({ actor: superAdmin, identity: inGroup, requiredGroup: GROUP, stepUp: true }).ok, true);

  assert.equal((staffPrivilegeCheck({ actor: null, identity: inGroup, stepUp: true }) as { status: number }).status, 401);
});

test('an OTP-style group-less identity never opens super-admin', () => {
  // One-time-PIN logins carry an email and no IdP group claims. The OTP path
  // is how staff reach the backend, but owners must use the real IdP method
  // for anything gated — the group leg cannot be satisfied without it.
  const otpIdentity = { email: 'staff@company.com', subject: 'otp-subject-1', groups: [] as string[] };
  assert.equal(staffSuperAdminSession(superAdmin, otpIdentity, GROUP), false);
  const denied = staffPrivilegeCheck({ actor: superAdmin, identity: otpIdentity, requiredGroup: GROUP, stepUp: true });
  assert.equal(denied.ok, false);
  assert.equal((denied as { code?: string }).code, 'SUPER_ADMIN_GROUP_REQUIRED');
  // A missing (not merely empty) group list behaves the same way. A token with
  // no readable groups must never satisfy a configured requirement.
  const deniedNull = staffPrivilegeCheck({ actor: superAdmin, identity: { email: 'staff@company.com', subject: 'otp-subject-2', groups: undefined as unknown as string[] }, requiredGroup: GROUP, stepUp: true });
  assert.equal((deniedNull as { code?: string }).code, 'SUPER_ADMIN_GROUP_REQUIRED');
  // Day-to-day staff work does not read groups at all: OTP staff with a
  // session and a step-up edit accounts like anyone else.
  assert.equal(staffEditorCheck({ actor: regularAdmin, stepUp: true }).ok, true);
});

test('account edits need the Administrator role and a step-up', () => {
  assert.equal((staffEditorCheck({ actor: null, stepUp: true }) as { status: number }).status, 401);
  assert.equal((staffEditorCheck({ actor: salesStaff, stepUp: true }) as { status: number }).status, 403);
  assert.equal((staffEditorCheck({ actor: regularAdmin, stepUp: false }) as { code?: string }).code, 'STEP_UP_REQUIRED');
  assert.equal(staffEditorCheck({ actor: regularAdmin, stepUp: true }).ok, true);
  assert.equal(staffEditorCheck({ actor: superAdmin, stepUp: true }).ok, true);
});

function stepUpFixture() {
  const db = new DatabaseSync(':memory:');
  const query = async (sql: string, params: any[]) => db.prepare(sql).all(...params);
  return { db, query };
}

const longToken = 'a'.repeat(72);

test('a step-up token is bound to the account that confirmed it and expires', async t => {
  const f = stepUpFixture();
  t.after(() => f.db.close());
  const token = await issueStepUp(f.query, 'usr-super');
  const cookie = `idofera_staff_step_up=${token}`;
  assert.equal(await hasStepUp(cookie, 'usr-super', f.query), true);
  assert.equal(await hasStepUp(cookie, 'usr-other', f.query), false, 'another account must not inherit the proof');

  f.db.exec('UPDATE staff_step_ups SET expires_at = 0');
  assert.equal(await hasStepUp(cookie, 'usr-super', f.query), false, 'an expired proof is not a proof');

  const revoked = await issueStepUp(f.query, 'usr-super');
  await revokeStepUp(`idofera_staff_step_up=${revoked}`, f.query);
  assert.equal(await hasStepUp(`idofera_staff_step_up=${revoked}`, 'usr-super', f.query), false);

  const perUser = await issueStepUp(f.query, 'usr-super');
  await revokeStepUpForUser(f.query, 'usr-super');
  assert.equal(await hasStepUp(`idofera_staff_step_up=${perUser}`, 'usr-super', f.query), false, 'a password change revokes the proof');
});

test('a malformed or unknown step-up cookie is simply not a step-up', async t => {
  const f = stepUpFixture();
  t.after(() => f.db.close());
  assert.equal(await hasStepUp(`idofera_staff_step_up=${longToken}`, 'usr-super', f.query), false, 'a missing table must not throw');
  assert.equal(await hasStepUp('', 'usr-super', f.query), false);
  assert.equal(await hasStepUp('idofera_staff_step_up=nope', 'usr-super', f.query), false);
  assert.equal(await hasStepUp(`idofera_staff_step_up=${longToken}`, '', f.query), false, 'no account, no step-up');
});

test('the step-up lifetime is configurable and defaults to ten minutes', async t => {
  const f = stepUpFixture();
  t.after(() => f.db.close());
  assert.equal(STEP_UP_SECONDS, 600);
  await issueStepUp(f.query, 'usr-super', 1);
  const row = f.db.prepare('SELECT expires_at FROM staff_step_ups').get() as { expires_at: number };
  assert.ok(row.expires_at > Date.now(), 'the token must not be born expired');
  assert.ok(row.expires_at <= Date.now() + 1100, 'the expiry must honour the shorter lifetime');
});
