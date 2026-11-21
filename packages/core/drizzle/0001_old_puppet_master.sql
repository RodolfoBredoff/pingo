CREATE TABLE `chat_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`sender` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_log_at_idx` ON `chat_log` (`at`);