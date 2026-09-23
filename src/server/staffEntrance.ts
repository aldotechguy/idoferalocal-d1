export const ENTRANCE_COOKIE = 'idofera_staff_entrance';
export const ENTRANCE_SECONDS = 300;
type Query = (sql: string, params: any[]) => Promise<any[]>;
const schema = 'CREATE TABLE IF NOT EXISTS staff_entrances (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)';

/**
 * The schema statement is idempotent, but it still costs a D1 statement (and a
 * distributed-systems write gate) on EVERY gated request — hasEntrance ran it
 * behind every staff page load and private API call. It now runs only on the
 * rare operations (issue/revoke); the hot read treats a missing table as "no
 * entrance", which is exactly what it means on a database where no entrance
 * has been issued yet.
 */
const noSuchTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message ?? error));

export function isStaffPage(path: string) {
  return /^\/(labs|app)(\/|$)/.test(path);
}

export function isPrivateApi(path: string) {
  if (!path.startsWith('/api/')) return false;
  if (path === '/api/health' || path === '/api/mall' || path.startsWith('/api/mall/')) return false;
  // Machine-to-machine: the scheduled outbox drain posts to its own
  // /api/mall-webhook with an HMAC signature and no staff cookie, so gating it
  // behind the staff entrance would 401 (then dead-letter) every notification.
  if (path === '/api/mall-webhook') return false;
  return !['/api/auth/entrance', '/api/auth/login', '/api/auth/google', '/api/auth/session', '/api/auth/logout'].includes(path);
}

function tokenFromCookie(cookie: string) {
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${ENTRANCE_COOKIE}=`))?.slice(ENTRANCE_COOKIE.length + 1) || '';
}
async function hash(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
}
export function entranceCookie(token = '', secure = true) {
  return `${ENTRANCE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? ENTRANCE_SECONDS : 0}${secure ? '; Secure' : ''}`;
}
export async function issueEntrance(query: Query) {
  await query(schema, []);
  await query('DELETE FROM staff_entrances WHERE expires_at <= ?', [Date.now()]);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await query('INSERT INTO staff_entrances (token_hash, expires_at) VALUES (?, ?)', [await hash(token), Date.now() + ENTRANCE_SECONDS * 1000]);
  return token;
}
export async function hasEntrance(cookie: string, query: Query) {
  const token = tokenFromCookie(cookie);
  if (!/^[a-f0-9-]{72}$/.test(token)) return false;
  try {
    const rows = await query('SELECT expires_at FROM staff_entrances WHERE token_hash = ? AND expires_at > ?', [await hash(token), Date.now()]);
    return rows.length > 0;
  } catch (error) {
    // No entrance has ever been issued against this database (or the table was
    // just recreated), so there is nothing to accept. A missing table must not
    // 500 the staff gate, and must not pay a DDL statement per gated request.
    if (noSuchTable(error)) return false;
    throw error;
  }
}
export async function revokeEntrance(cookie: string, query: Query) {
  const token = tokenFromCookie(cookie);
  if (!token) return;
  await query(schema, []);
  await query('DELETE FROM staff_entrances WHERE token_hash = ?', [await hash(token)]);
}