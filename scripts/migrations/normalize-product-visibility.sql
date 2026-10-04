-- Idempotent: preserve stock, pricing, and archived products.
-- 100% relational: only the `products` table is normalized now; the legacy
-- `app_documents` payload rewrite was removed with the document store.
UPDATE products SET status = 'Active' WHERE status IN ('Low Stock', 'Out of Stock');