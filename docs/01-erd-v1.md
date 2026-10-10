# ERD v1 — Unified POS + Biz + Single-Vendor Mall (/mall) on D1 `idofera` (Part 1)

Conventions: IDs TEXT (preserve old IDs for 1:1 ETL). Money INTEGER kobo.
Dates ISO TEXT. D1 batch() for atomic multi-table writes.

## users (from app_users)
id PK, email UNIQUE, username UNIQUE, display_name, role, status,
avatar_url, password_hash, password_salt, iterations DEFAULT 100000,
is_super_admin 0/1, is_protected 0/1, created_at, last_login, password_last_changed

## categories (new — replaces Product.category string)
id PK, name, slug UNIQUE, parent_id FK NULL, image_url NULL

## products (from collection=products)
id PK, sku UNIQUE, barcode, name, description, category_id FK NULL, brand,
supplier_id FK NULL, cost_price INT, retail_price INT, wholesale_price INT,
min_wholesale_qty DEFAULT 1, dealer_price NULL, promo_price NULL, min_selling_price,
stock_qty DEFAULT 0, low_stock_threshold DEFAULT 5, unit DEFAULT 'pcs',
expiry_date NULL, status DEFAULT 'Active', images_json DEFAULT '[]',
is_mall_listed DEFAULT 0, mall_price NULL, mall_description NULL, created_at, updated_at.
Indexes: (sku), (is_mall_listed, stock_qty), (category_id), (supplier_id)

## product_variants
id PK, product_id FK CASCADE, name, sku, price_delta INT DEFAULT 0, stock_qty DEFAULT 0

## customers / suppliers
customers: id PK, name, phone UNIQUE, email, address, purchase_history_count,
outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at
suppliers: id PK, name, contact_person, email, phone, address, payment_terms,
products_count, opening_balance_kobo DEFAULT 0, outstanding_balance_kobo, created_at

## sales + sale_items (Sale.items[] split)
sales: id PK, receipt_no UNIQUE (invoiceNo), customer_id FK NULL, customer_name,
type[Retail|Wholesale], subtotal/discount/tax/delivery_fee/total/paid (_kobo),
payment_method, payment_breakdown_json NULL, status, notes NULL, created_by FK,
is_historical 0/1, expense_id NULL, created_at
sale_items: id PK, sale_id FK CASCADE, product_id FK, product_name, sku, qty,
unit_price_kobo, cost_price_kobo, total_kobo, is_wholesale 0/1, is_clearance 0/1
Indexes: sales(created_at), sales(customer_id), sale_items(sale_id)

## purchases + purchase_items + receiving_history
purchases: id PK, po_number UNIQUE, supplier_id FK, supplier_name,
delivery_fee_kobo, logistics_fee_kobo, total_kobo, paid_kobo,
payment_status, delivery_status, expected_delivery, created_by FK,
inspection fields, notes, created_at, updated_at
purchase_items: id PK, purchase_id FK CASCADE, product_id FK, product_name, sku,
qty, unit_cost_kobo, total_kobo, received_qty, accepted_qty, damaged_qty
receiving_history: id PK, purchase_id FK CASCADE, grn_number, received_by, notes, items_json, received_at

## expenses / stock / pricing / treasury
expenses: id PK, title, category, amount_kobo, description, spent_by FK,
payment_method, receipt_url, date, is_historical 0/1, sale_id NULL, created_at
stock_movements: id PK, product_id FK, product_name, type, qty (signed),
prev_stock, new_stock, ref_id NULL, notes NULL, performed_by FK, created_at.
Index: (product_id, created_at)
pricing_history: id PK, product_id FK, product_name, old/new (_kobo), price_type, changed_by, reason, created_at
money_movements: id PK, date, type, subtype NULL, source/dest_account NULL,
amount_kobo, notes NULL, ref_no NULL, ref_id NULL, performed_by FK, created_at

## ops / support
delivery_orders, held_orders, whatsapp_preorders, notifications, audit_logs,
settings(key PK, value_json), app_sessions, sync_revisions — same shape as today, FKs added.

## Mall v1 — single vendor (NEW tables only)
mall_carts: id PK, customer_id FK NULL, session_id NULL, status, updated_at
mall_cart_items: id PK, cart_id FK CASCADE, product_id FK, variant_id NULL, qty, unit_price_kobo
mall_orders: id PK, order_no UNIQUE, customer_id FK NULL, customer_name, phone,
status[pending|paid|packed|shipped|delivered|cancelled|refunded],
subtotal/delivery_fee/discount/total (_kobo), payment_ref NULL,
delivery_address_json NULL, linked_sale_id FK NULL, created_at
mall_order_items: id PK, mall_order_id FK CASCADE, product_id FK, product_name, qty, unit_price_kobo, total_kobo
payments: id PK, order_id FK NULL, sale_id FK NULL, provider, reference UNIQUE, amount_kobo, status, raw_json NULL, created_at
reviews: v1.1 table (created now, UI later): id PK, product_id FK, customer_id FK, rating, comment NULL, created_at

## Atomic writes (D1 batch)
- POS sale: sales + sale_items[] + products.stock_qty + stock_movements(Outgoing) + money_movements(Sale Inflow)
- Mall checkout: mall_orders + mall_order_items[] + products.stock_qty + stock_movements(mall_order) + payments(pending); on paid -> mirror INSERT sales
- Purchase receive: purchases + purchase_items + products.stock/cost + stock_movements(Incoming) + receiving_history

