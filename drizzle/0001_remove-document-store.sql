DROP TABLE `app_documents`;--> statement-breakpoint
DROP TABLE `sync_revisions`;--> statement-breakpoint
ALTER TABLE `customers` ADD `overage_balance_kobo` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mall_orders` ADD `customer_email` text;--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `shortage_qty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `excess_qty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `returned_qty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `overage_applied_kobo` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `overage_created_kobo` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `total_refunded_kobo` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `refunds_json` text;