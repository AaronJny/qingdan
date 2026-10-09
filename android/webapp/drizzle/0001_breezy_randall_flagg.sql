CREATE TABLE `notification_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`delivered_at` text NOT NULL,
	`snoozed_until` text
);
--> statement-breakpoint
CREATE INDEX `idx_notification_user_snooze` ON `notification_receipts` (`user_id`,`snoozed_until`);