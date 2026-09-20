CREATE TABLE `app_documents` (
	`owner_id` text NOT NULL,
	`collection` text NOT NULL,
	`document_id` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `collection`, `document_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_app_documents_owner_collection` ON `app_documents` (`owner_id`,`collection`);--> statement-breakpoint
CREATE TABLE `app_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_app_sessions_user_expiry` ON `app_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`details` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_time` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`parent_id` text,
	`image_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`address` text,
	`purchase_history_count` integer DEFAULT 0 NOT NULL,
	`outstanding_balance_kobo` integer DEFAULT 0 NOT NULL,
	`loyalty_points` integer DEFAULT 0 NOT NULL,
	`lifetime_value_kobo` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customers_phone` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `delivery_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_no` text NOT NULL,
	`sale_id` text,
	`invoice_no` text DEFAULT '' NOT NULL,
	`customer_id` text,
	`customer_name` text DEFAULT '' NOT NULL,
	`customer_phone` text,
	`delivery_address` text,
	`items_json` text DEFAULT '[]' NOT NULL,
	`delivery_fee_kobo` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Pending Pickup' NOT NULL,
	`is_pickup_confirmed` integer DEFAULT 0 NOT NULL,
	`courier_notes` text,
	`notes` text,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_orders_delivery_no_unique` ON `delivery_orders` (`delivery_no`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT 'Miscellaneous' NOT NULL,
	`amount_kobo` integer DEFAULT 0 NOT NULL,
	`description` text,
	`spent_by` text DEFAULT '' NOT NULL,
	`payment_method` text DEFAULT 'Cash' NOT NULL,
	`receipt_url` text,
	`date` text NOT NULL,
	`is_historical` integer DEFAULT 0 NOT NULL,
	`sale_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_expenses_date` ON `expenses` (`date`);--> statement-breakpoint
CREATE TABLE `held_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_json` text NOT NULL,
	`held_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mall_cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`product_id` text,
	`variant_id` text,
	`qty` integer DEFAULT 0 NOT NULL,
	`unit_price_kobo` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cart_items_cart` ON `mall_cart_items` (`cart_id`);--> statement-breakpoint
CREATE TABLE `mall_carts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`session_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mall_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`mall_order_id` text NOT NULL,
	`product_id` text,
	`product_name` text DEFAULT '' NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	`unit_price_kobo` integer DEFAULT 0 NOT NULL,
	`total_kobo` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mall_order_items_order` ON `mall_order_items` (`mall_order_id`);--> statement-breakpoint
CREATE TABLE `mall_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`customer_id` text,
	`customer_name` text DEFAULT '' NOT NULL,
	`customer_phone` text,
	`customer_email` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`subtotal_kobo` integer DEFAULT 0 NOT NULL,
	`delivery_fee_kobo` integer DEFAULT 0 NOT NULL,
	`discount_kobo` integer DEFAULT 0 NOT NULL,
	`total_kobo` integer DEFAULT 0 NOT NULL,
	`payment_ref` text,
	`delivery_address_json` text,
	`linked_sale_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mall_orders_order_no_unique` ON `mall_orders` (`order_no`);--> statement-breakpoint
CREATE INDEX `idx_mall_orders_status_time` ON `mall_orders` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `money_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`source_account` text,
	`dest_account` text,
	`amount_kobo` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`ref_no` text,
	`ref_id` text,
	`performed_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_money_date` ON `money_movements` (`date`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`type` text NOT NULL,
	`is_read` integer DEFAULT 0 NOT NULL,
	`link` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`sale_id` text,
	`provider` text DEFAULT 'cash' NOT NULL,
	`reference` text NOT NULL,
	`amount_kobo` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`raw_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_reference_unique` ON `payments` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_payments_order` ON `payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `pricing_history` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text,
	`product_name` text DEFAULT '' NOT NULL,
	`old_price_kobo` integer DEFAULT 0 NOT NULL,
	`new_price_kobo` integer DEFAULT 0 NOT NULL,
	`price_type` text DEFAULT 'Retail' NOT NULL,
	`changed_by` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pricing_product` ON `pricing_history` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`price_delta_kobo` integer DEFAULT 0 NOT NULL,
	`stock_qty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_variants_product` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`barcode` text DEFAULT '' NOT NULL,
	`qr_code` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category_id` text,
	`category_name` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`supplier_id` text,
	`supplier_name` text DEFAULT '' NOT NULL,
	`images_json` text DEFAULT '[]' NOT NULL,
	`cost_price_kobo` integer DEFAULT 0 NOT NULL,
	`retail_price_kobo` integer DEFAULT 0 NOT NULL,
	`wholesale_price_kobo` integer DEFAULT 0 NOT NULL,
	`min_wholesale_qty` integer DEFAULT 1 NOT NULL,
	`dealer_price_kobo` integer,
	`promo_price_kobo` integer,
	`min_selling_price_kobo` integer DEFAULT 0 NOT NULL,
	`stock_qty` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 5 NOT NULL,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`expiry_date` text,
	`status` text DEFAULT 'Active' NOT NULL,
	`is_mall_listed` integer DEFAULT 0 NOT NULL,
	`mall_price_kobo` integer,
	`mall_description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_products_supplier` ON `products` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `idx_products_mall` ON `products` (`is_mall_listed`,`stock_qty`);--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`product_id` text,
	`product_name` text DEFAULT '' NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	`unit_cost_kobo` integer DEFAULT 0 NOT NULL,
	`total_kobo` integer DEFAULT 0 NOT NULL,
	`received_qty` integer DEFAULT 0 NOT NULL,
	`accepted_qty` integer DEFAULT 0 NOT NULL,
	`damaged_qty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_items_po` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`po_number` text NOT NULL,
	`supplier_id` text,
	`supplier_name` text DEFAULT '' NOT NULL,
	`delivery_fee_kobo` integer DEFAULT 0 NOT NULL,
	`logistics_fee_kobo` integer DEFAULT 0 NOT NULL,
	`total_kobo` integer DEFAULT 0 NOT NULL,
	`paid_kobo` integer DEFAULT 0 NOT NULL,
	`payment_status` text DEFAULT 'Unpaid' NOT NULL,
	`delivery_status` text DEFAULT 'Pending' NOT NULL,
	`expected_delivery` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_po_number_unique` ON `purchases` (`po_number`);--> statement-breakpoint
CREATE INDEX `idx_purchases_supplier` ON `purchases` (`supplier_id`);--> statement-breakpoint
CREATE TABLE `receiving_history` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`grn_number` text DEFAULT '' NOT NULL,
	`received_by` text DEFAULT '' NOT NULL,
	`notes` text,
	`items_json` text DEFAULT '[]' NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_receiving_po` ON `receiving_history` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text,
	`customer_id` text,
	`rating` integer DEFAULT 5 NOT NULL,
	`comment` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_product` ON `reviews` (`product_id`);--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text,
	`product_name` text DEFAULT '' NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	`unit_price_kobo` integer DEFAULT 0 NOT NULL,
	`cost_price_kobo` integer DEFAULT 0 NOT NULL,
	`total_kobo` integer DEFAULT 0 NOT NULL,
	`is_wholesale` integer DEFAULT 0 NOT NULL,
	`is_clearance` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sale_items_sale` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_no` text NOT NULL,
	`customer_id` text,
	`customer_name` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'Retail' NOT NULL,
	`subtotal_kobo` integer DEFAULT 0 NOT NULL,
	`discount_kobo` integer DEFAULT 0 NOT NULL,
	`tax_kobo` integer DEFAULT 0 NOT NULL,
	`delivery_fee_kobo` integer DEFAULT 0 NOT NULL,
	`total_kobo` integer DEFAULT 0 NOT NULL,
	`paid_kobo` integer DEFAULT 0 NOT NULL,
	`payment_method` text DEFAULT 'Cash' NOT NULL,
	`payment_breakdown_json` text,
	`status` text DEFAULT 'Completed' NOT NULL,
	`notes` text,
	`created_by` text DEFAULT '' NOT NULL,
	`order_taken_by` text,
	`is_historical` integer DEFAULT 0 NOT NULL,
	`expense_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_receipt_no_unique` ON `sales` (`receipt_no`);--> statement-breakpoint
CREATE INDEX `idx_sales_created` ON `sales` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sales_customer` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text,
	`product_name` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	`prev_stock` integer DEFAULT 0 NOT NULL,
	`new_stock` integer DEFAULT 0 NOT NULL,
	`ref_id` text,
	`notes` text,
	`performed_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stock_product_time` ON `stock_movements` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_person` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text,
	`payment_terms` text DEFAULT 'Due on Receipt' NOT NULL,
	`products_count` integer DEFAULT 0 NOT NULL,
	`opening_balance_kobo` integer DEFAULT 0 NOT NULL,
	`outstanding_balance_kobo` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_revisions` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`username` text,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`avatar_url` text,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer DEFAULT 100000 NOT NULL,
	`is_super_admin` integer DEFAULT 0 NOT NULL,
	`is_protected` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`last_login` text,
	`password_last_changed` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `whatsapp_preorders` (
	`id` text PRIMARY KEY NOT NULL,
	`preorder_no` text NOT NULL,
	`customer_id` text,
	`customer_name` text DEFAULT '' NOT NULL,
	`customer_phone` text DEFAULT '' NOT NULL,
	`delivery_address` text,
	`notes` text,
	`items_json` text DEFAULT '[]' NOT NULL,
	`subtotal_kobo` integer DEFAULT 0 NOT NULL,
	`discount_kobo` integer DEFAULT 0 NOT NULL,
	`delivery_fee_kobo` integer DEFAULT 0 NOT NULL,
	`deposit_kobo` integer DEFAULT 0 NOT NULL,
	`total_kobo` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Pending Review' NOT NULL,
	`converted_sale_id` text,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_preorders_preorder_no_unique` ON `whatsapp_preorders` (`preorder_no`);