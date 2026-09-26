CREATE TABLE IF NOT EXISTS app_documents (owner_id TEXT NOT NULL, collection TEXT NOT NULL, document_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(owner_id, collection, document_id));
CREATE INDEX IF NOT EXISTS idx_app_documents_owner_collection ON app_documents (owner_id, collection);
CREATE TABLE IF NOT EXISTS sync_revisions (owner_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE, username TEXT UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT "Active", avatar_url TEXT, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL DEFAULT 100000, is_super_admin INTEGER NOT NULL DEFAULT 0, is_protected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login TEXT, password_last_changed TEXT);
CREATE INDEX IF NOT EXISTS idx_app_users_login ON app_users (email, username, status);
CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_expiry ON app_sessions (user_id, expires_at);

INSERT OR REPLACE INTO app_documents ("owner_id", "collection", "document_id", "payload", "updated_at") VALUES ('idofera-business', 'settings', 'app_settings', '{"id":"app_settings","storeName":"Idofera Packaging Ltd","currencySymbol":"₦"}', 1788074698361);
INSERT OR REPLACE INTO app_documents ("owner_id", "collection", "document_id", "payload", "updated_at") VALUES ('idofera-business', 'products', 'prod-1', '{"id":"prod-1","name":"100ml Bottle","sellingPrice":350,"costPrice":200,"currentStock":50}', 1788074698374);
INSERT OR REPLACE INTO sync_revisions ("owner_id", "revision", "updated_at") VALUES ('idofera-business', 1788074698374, 1788074698374);
-- Seeded app_users/app_sessions rows REMOVED: they contained known
-- default password hashes and live session tokens. Provision accounts via
-- BOOTSTRAP_ADMIN_* / scripts/provision-admin.ts instead. See
-- docs/mall-launch-safety.md.