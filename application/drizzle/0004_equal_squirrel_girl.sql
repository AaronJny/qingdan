CREATE TABLE `operation_receipts` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
