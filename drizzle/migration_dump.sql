INSERT OR REPLACE INTO app_documents ("owner_id", "collection", "document_id", "payload", "updated_at") VALUES ('idofera-business', 'settings', 'app_settings', '{"id":"app_settings","storeName":"Idofera Packaging Ltd","currencySymbol":"₦"}', 1788074698361);
INSERT OR REPLACE INTO app_documents ("owner_id", "collection", "document_id", "payload", "updated_at") VALUES ('idofera-business', 'products', 'prod-1', '{"id":"prod-1","name":"100ml Bottle","sellingPrice":350,"costPrice":200,"currentStock":50}', 1788074698374);
INSERT OR REPLACE INTO sync_revisions ("owner_id", "revision", "updated_at") VALUES ('idofera-business', 1788074698374, 1788074698374);
-- Seeded app_users/app_sessions rows REMOVED: they contained known
-- default password hashes and live session tokens. Provision accounts via
-- BOOTSTRAP_ADMIN_* / scripts/provision-admin.ts instead. See
-- docs/mall-launch-safety.md.
