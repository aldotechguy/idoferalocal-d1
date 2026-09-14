CREATE TABLE IF NOT EXISTS `app_documents` (
	`owner_id` text NOT NULL,
	`collection` text NOT NULL,
	`document_id` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `collection`, `document_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_app_documents_owner_collection` ON `app_documents` (`owner_id`,`collection`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sync_revisions` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
