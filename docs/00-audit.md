# Phase 0 — Audit (auto-generated 2026-09-15, branch `feature/unified-mall`)

## 1. Prod D1 bindings (from wrangler.toml)
- database_name: `idofera-d1`
- database_id: `3e95a550-a091-490b-819d-f0acb7ea8dd8`
- worker entry: `sites-worker.ts`, binding `DB`
- Target new relational D1: name `idofera` (to be created in Phase 1)

## 2. Document-store truth (sites-worker.ts)
- `ALLOWED_STORES`: products, customers, suppliers, sales, purchases, expenses,
  notifications, auditLogs, stockMovements, pricingHistory, settings,
  heldOrders, whatsAppPreOrders, deliveryOrders, moneyMovements
- Core tables: `app_documents(owner_id, collection, document_id, payload, updated_at)`,
  `sync_revisions(owner_id, revision, updated_at)`,
  `app_users(id, email UNIQUE, username UNIQUE, display_name, role, status, avatar_url, password_hash, password_salt, iterations, is_super_admin, is_protected, created_at, last_login, password_last_changed)`,
  `app_sessions(token_hash PK, user_id FK, created_at, expires_at)`
- owner_id constant: `idofera-business`
- Drizzle source today (`db/schema.ts`): only `appDocuments` + `syncRevisions` — proper domain tables do NOT exist yet.
- Migrations present: `drizzle/0000_d1_storage.sql`, `drizzle/0001_app_auth.sql`, `full_migration.sql`, `migration_dump.sql` (document-store only)

## 3. Type truth (src/types/index.ts)
- UserProfile: id, email, username?, displayName, role[Administrator|Sales Staff|Accountant|Store Manager], status, createdAt, lastLogin?, isProtected?, isSuperAdmin?
- Product: id, name, sku, barcode, qrCode?, category(string), brand, supplierId, supplierName, description, images[], costPrice, retailPrice, wholesalePrice, minWholesaleQty, dealerPrice?, promotionalPrice?, minimumSellingPrice, currentStock, minimumStockLevel, unit, expiryDate?, status[Active|Low Stock|Out of Stock|Archived], createdAt, updatedAt
- PricingHistory: productId, productName, oldPrice, newPrice, priceType[Retail|Wholesale|Dealer|Promotional], changedBy, reason
- StockMovement: productId, productName, type[Opening Stock|Incoming|Outgoing|Adjustment|Damaged|Returned|Lost|Transfer], quantity, previousStock, newStock, referenceNo?, notes?, performedBy
- Sale: invoiceNo, customerId?, customerName, type[Retail|Wholesale], items[{productId, productName, sku, quantity, unitPrice, costPrice, total, isWholesale?, useRetailPrice?, isClearance?}], subtotal, discount, tax, deliveryFee?, totalAmount, paidAmount, paymentMethod[Cash|Card|Mobile Transfer|Bank Transfer|Store Credit|Split], paymentBreakdown?, status[Completed|Draft|Held|Refunded], notes?, createdBy, isHistorical?, expenseId?
- Customer: name, phone, email, address?, purchaseHistoryCount, outstandingBalance, loyaltyPoints, lifetimeValue
- Supplier: name, contactPerson, email, phone, address?, paymentTerms, productsCount, outstandingBalance (+ opening balance per commit 2bd9461)
- PurchaseOrder: poNumber, supplierId, supplierName, items[{productId, quantity, unitCost, received/accepted/damaged, customRetailPrice?}], deliveryFee?, totalAmount, paidAmount, paymentStatus[Paid|Partial|Overdue|Unpaid], deliveryStatus[Received|Partial|Pending|Cancelled|Draft], receivingHistory[], inspection fields
- Expense: title, category[Rent|Salaries|Electricity|Fuel|Marketing|Repairs|Lunch|Logistics|Miscellaneous], amount, paidBy, paymentMethod, receiptUrl?, date, isHistorical?, saleId?
- MoneyMovement: date, type[Opening Balance|Balance Adjustment|Sale Inflow|Sale Refund|Expense Outflow|Supplier Payment|Customer Debt Payment|Internal Transfer|Owner Drawing|Owner Repayment], sourceAccount?, destinationAccount?[Biz Account|Physical Cash], amount, referenceId?, performedBy
- DeliveryOrder, WhatsAppPreOrder(preOrderNo, items[], depositAmount, status), StoreSettings, AuditLog, NotificationItem, heldOrders

## 4. Sync / storage layer
- `src/services/d1StorageService.ts` — snapshot merge (local IndexedDB <-> D1 payload)
- `src/db/indexedDB.ts` — offline cache
- `src/firebase/syncManager.ts`, `src/hooks/useCloudSync.ts` — revision-based sync
- `scripts/push-to-d1.ts` — local `data/d1_storage.db` -> Cloud D1 via REST `/query` (batches of 25/50, UPSERT app_documents) — **removed** with the Node REST bridge: the deployed Worker owns every D1 write and the Node runtime only serves its own local store
- Money: kobo-INTEGER decision for new schema (avoid float). Existing TS uses naira floats — ETL must Math.round(x*100).

## 5. Business rules captured (to become acceptance tests)
1. Stock decremented on Completed sale; refund restores stock + creates Sale Refund money movement.
2. Historical sales/expenses (isHistorical) must NOT touch treasury balances.
3. Supplier opening balance seeds outstandingBalance at creation.
4. Sale with Store Credit increases customer.outstandingBalance; Customer Debt Payment decreases it.
5. Purchase receive increases stock + stockMovements(Incoming); Supplier Payment decreases supplier balance + money movement.
6. All money in new DB as INTEGER kobo.

## 6. Freeze
- Tag `v1-pos-stable` = commit 2bd9461 (HEAD of main at branch point). Rollback: redeploy tag + rebind worker to idofera-d1.
- main = bugfix-only until cutover. All new work on feature/unified-mall.
