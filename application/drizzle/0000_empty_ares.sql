CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_record` ON `attachments` (`record_id`);--> statement-breakpoint
CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_history_owner_date` ON `history` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_history_record` ON `history` (`record_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_invitations_token` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `members` (
	`list_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`list_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_members_user` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`list_id` text,
	`data` text NOT NULL,
	`mutation_id` text DEFAULT '' NOT NULL,
	`recurrence_source` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_records_owner_kind` ON `records` (`owner_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_records_list` ON `records` (`list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_records_recurrence_source` ON `records` (`recurrence_source`) WHERE "records"."kind" = 'task' AND "records"."deleted" = 0 AND "records"."recurrence_source" IS NOT NULL AND "records"."recurrence_source" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_records_one_active_focus` ON `records` (`owner_id`) WHERE "records"."kind" = 'focus' AND "records"."deleted" = 0 AND json_extract("records"."data", '$.focusStatus') IN ('running','paused');