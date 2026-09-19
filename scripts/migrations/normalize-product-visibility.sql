-- Idempotent: preserve stock, pricing, and archived products.
UPDATE products SET status = 'Active' WHERE status IN ('Low Stock', 'Out of Stock');
UPDATE app_documents
SET payload = json_set(payload, '$.status', 'Active')
WHERE collection = 'products'
  AND json_extract(payload, '$.status') IN ('Low Stock', 'Out of Stock');