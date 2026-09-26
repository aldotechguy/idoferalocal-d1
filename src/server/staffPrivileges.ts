/**
 * The staff privilege policy, shared by the Worker and the Node twin.
 *
 * Cloudflare Access authenticates a person (and, when the IdP asserts them,
 * group memberships). It never grants privilege. A super-admin action requires
 * ALL of:
 *
 *   1. `app_users.is_super_admin = 1`            — the roster decides
 *   2. the IdP group, when one is configured     — the IdP confirms
 *   3. a fresh password step-up                  — the person confirms
 *
 * Keeping the composition here (rather than inline in each runtime) is what
 * makes the policy testable: `scripts/staff-privileges.test.ts` exercises the
 * whole matrix, and both runtimes only translate the result into a response.
 */

import { accessGroupAllowed, type AccessIdentity } from './accessJwt.js';

export interface PrivilegedActor {
  id: string;
  is_super_admin?: number | boolean | null;
}

export function asSuperAdminFlag(actor: PrivilegedActor | null | undefined) {
  return Boolean(actor?.is_super_admin);
}

/**
 * A super-admin *session*: the DB flag AND, when configured, the IdP group.
 * Both are re-evaluated per request, so removing somebody from the IdP group
 * downgrades their next call without any database write.
 */
export function staffSuperAdminSession(
  actor: PrivilegedActor | null | undefined,
  identity: AccessIdentity | null,
  requiredGroup?: string,
) {
  if (!asSuperAdminFlag(actor)) return false;
  return accessGroupAllowed(identity, requiredGroup);
}

export interface PrivilegeDenial {
  ok: false;
  status: 401 | 403;
  error: string;
  code?: 'STEP_UP_REQUIRED' | 'SUPER_ADMIN_GROUP_REQUIRED';
}

export type PrivilegeDecision = { ok: true } | PrivilegeDenial;

export const STEP_UP_REQUIRED_ERROR = 'Confirm your password to continue.';
export const SUPER_ADMIN_GROUP_ERROR = 'Your identity provider has not confirmed the super-administrator group.';

/**
 * The full check for a destructive/privileged staff action. `stepUp` is the
 * result of `hasStepUp(...)` for the acting account.
 */
export function staffPrivilegeCheck(input: {
  actor: PrivilegedActor | null | undefined;
  identity: AccessIdentity | null;
  requiredGroup?: string;
  stepUp: boolean;
}): PrivilegeDecision {
  const { actor, identity, requiredGroup, stepUp } = input;
  if (!actor) return { ok: false, status: 401, error: 'Authentication required.' };
  if (!asSuperAdminFlag(actor)) return { ok: false, status: 403, error: 'Super administrator access required.' };
  if (!staffSuperAdminSession(actor, identity, requiredGroup)) {
    return { ok: false, status: 403, error: SUPER_ADMIN_GROUP_ERROR, code: 'SUPER_ADMIN_GROUP_REQUIRED' };
  }
  if (!stepUp) return { ok: false, status: 403, error: STEP_UP_REQUIRED_ERROR, code: 'STEP_UP_REQUIRED' };
  return { ok: true };
}

/** Privileged action for an account editor: Administrator role plus a step-up. */
export function staffEditorCheck(input: {
  actor: (PrivilegedActor & { role?: string }) | null | undefined;
  stepUp: boolean;
}): PrivilegeDecision {
  const { actor, stepUp } = input;
  if (!actor) return { ok: false, status: 401, error: 'Authentication required.' };
  if (actor.role !== 'Administrator') return { ok: false, status: 403, error: 'Administrator access required.' };
  if (!stepUp) return { ok: false, status: 403, error: STEP_UP_REQUIRED_ERROR, code: 'STEP_UP_REQUIRED' };
  return { ok: true };
}
