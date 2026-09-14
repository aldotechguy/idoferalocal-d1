CREATE TABLE IF NOT EXISTS `app_users` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL UNIQUE,
  `username` text UNIQUE,
  `display_name` text NOT NULL,
  `role` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Active',
  `avatar_url` text,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `password_iterations` integer NOT NULL DEFAULT 100000,
  `is_super_admin` integer NOT NULL DEFAULT 0,
  `is_protected` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  `last_login` text,
  `password_last_changed` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_app_users_login` ON `app_users` (`email`, `username`, `status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_app_sessions_user_expiry` ON `app_sessions` (`user_id`, `expires_at`);
--> statement-breakpoint
PRAGMA optimize;
