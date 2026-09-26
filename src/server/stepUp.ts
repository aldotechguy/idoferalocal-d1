/**
 * Step-up confirmation for privileged staff actions.
 *
 * Access SSO (see `accessJwt.ts`) proves WHO the caller is, but it removes the
 * password as an independent factor. Managing users, resetting somebody else's
 * password, or touching a super-admin/protected account therefore requires a
 * fresh proof of possession of the caller's own password — the same PBKDF2
 * check `changeAuthPassword` already performs for a self-service change.
 *
 * The token shape is deliberately identical to `staffEntrance.ts`: a hashed
 * row with an expiry, DDL only on the rare write path, and a hot read that
 * treats a missing table as "no step-up".
 */

export const STEP_UP_COOKIE = 'idofera_staff_step_up';
export const STEP_UP_SECONDS = 600;

type Query = (sql: string, params: any[]) => Promise<any[]>;

const schema = 'CREATE TABLE IF NOT EXISTS staff_step_ups (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)';
const noSuchTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message ?? error));

function tokenFromCookie(cookie: string) {
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${STEP_UP_COOKIE}=`))?.slice(STEP_UP_COOKIE.length + 1) || '';
}

async function hash(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
}

export function stepUpCookie(token = '', secure = true, seconds = STEP_UP_SECONDS) {
  return `${STEP_UP_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? seconds : 0}${secure ? '; Secure' : ''}`;
}

export async function issueStepUp(query: Query, userId: string, seconds = STEP_UP_SECONDS) {
  await query(schema, []);
  await query('DELETE FROM staff_step_ups WHERE expires_at <= ?', [Date.now()]);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await query('INSERT INTO staff_step_ups (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [await hash(token), userId, Date.now() + seconds * 1000]);
  return token;
}

/**
 * A step-up token is bound to the account that confirmed it, so a token issued
 * to one staff member can never authorize another account's privileged action.
 */
export async function hasStepUp(cookie: string, userId: string, query: Query) {
  const token = tokenFromCookie(cookie);
  if (!/^[a-f0-9-]{72}$/.test(token) || !userId) return false;
  try {
    const rows = await query('SELECT expires_at FROM staff_step_ups WHERE token_hash = ? AND user_id = ? AND expires_at > ?', [await hash(token), userId, Date.now()]);
    return rows.length > 0;
  } catch (error) {
    if (noSuchTable(error)) return false;
    throw error;
  }
}

export async function revokeStepUp(cookie: string, query: Query) {
  const token = tokenFromCookie(cookie);
  if (!token) return;
  await query(schema, []);
  await query('DELETE FROM staff_step_ups WHERE token_hash = ?', [await hash(token)]);
}

/** A password change or account deletion must invalidate every existing token. */
export async function revokeStepUpForUser(query: Query, userId: string) {
  if (!userId) return;
  try {
    await query('DELETE FROM staff_step_ups WHERE user_id = ?', [userId]);
  } catch (error) {
    if (!noSuchTable(error)) throw error;
  }
}
