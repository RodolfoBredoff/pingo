CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'offered' NOT NULL,
	`offered_at` text NOT NULL,
	`answered_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`opt_in_at` text,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_phone_uq` ON `contacts` (`phone`);--> statement-breakpoint
CREATE TABLE `conversation_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`payload` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_message_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`starts_at` text,
	`ends_at` text,
	`all_day` integer DEFAULT false NOT NULL,
	`due_at` text,
	`location` text,
	`assignee_contact_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`confidence` real,
	`missing_fields` text,
	`evidence` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_status_start_idx` ON `items` (`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`channel_msg_id` text NOT NULL,
	`from_phone` text,
	`type` text NOT NULL,
	`text` text,
	`media_path` text,
	`transcript` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_channel_msg_uq` ON `messages` (`channel`,`channel_msg_id`);--> statement-breakpoint
CREATE TABLE `owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`tz` text DEFAULT 'America/Sao_Paulo' NOT NULL,
	`consent_at` text
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`remind_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`delivered_via` text,
	`cloud_schedule_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reminders_status_at_idx` ON `reminders` (`status`,`remind_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`role` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_at_idx` ON `usage` (`at`);