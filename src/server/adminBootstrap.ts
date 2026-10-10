export type AdminBootstrapEnv = {
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_USERNAME?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
};

/** Opt-in initial provisioning only. Never changes an existing user's password. */
export function bootstrapAdmin(env: AdminBootstrapEnv) {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const username = env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email && !username && !password) return null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !username || !/^[A-Za-z0-9_-]{3,64}$/.test(username) || !password || password.length < 20) {
    throw new Error('Initial administrator provisioning requires an email, username, and a unique password of at least 20 characters.');
  }
  return { id: 'usr-bootstrap-admin', email, username, password, displayName: 'Administrator', superAdmin: true };
}