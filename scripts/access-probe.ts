/**
 * Shared Cloudflare Access support for the deployment checks
 * (docs/staff-access.md §3 "Service tokens for the deployment checks"):
 *
 *  - `accessHeaders()` attaches a `CF-Access-Client-Id` / `CF-Access-Client-Secret`
 *    service token to every probe when those variables are exported, so the
 *    checks pass through the Access applications the way a service client would.
 *  - `accessDenied()` recognises an Access rejection — a 403, or a redirect to
 *    the `cloudflareaccess.com` team domain — as "anonymous staff access
 *    denied", exactly like a 401 from the origin.
 */
export function accessHeaders(): Record<string, string> {
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  return id && secret
    ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
    : {};
}

/** True when the edge refused an unauthenticated caller at Access. */
export function accessDenied(response: Response): boolean {
  if (response.status === 403) return true;
  if (response.status === 302 || response.status === 303) {
    return (response.headers.get('location') || '').includes('cloudflareaccess.com');
  }
  return false;
}
