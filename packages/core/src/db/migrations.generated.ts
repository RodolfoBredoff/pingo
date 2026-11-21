// ARQUIVO GERADO por scripts/embed-migrations.mjs. Não edite à mão.
export interface Migration {
  id: string
  statements: string[]
}

export const migrations: Migration[] = [
  {
    id: '0000_init',
    statements: [
      "CREATE TABLE `assignments` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`item_id` text NOT NULL,\n\t`contact_id` text NOT NULL,\n\t`status` text DEFAULT 'offered' NOT NULL,\n\t`offered_at` text NOT NULL,\n\t`answered_at` text,\n\tFOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action\n);",
      "CREATE TABLE `contacts` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`phone` text NOT NULL,\n\t`opt_in_at` text,\n\t`status` text DEFAULT 'pending' NOT NULL\n);",
      'CREATE UNIQUE INDEX `contacts_phone_uq` ON `contacts` (`phone`);',
      "CREATE TABLE `conversation_state` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`state` text DEFAULT 'idle' NOT NULL,\n\t`payload` text,\n\t`expires_at` text\n);",
      "CREATE TABLE `items` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`source_message_id` text,\n\t`kind` text NOT NULL,\n\t`title` text NOT NULL,\n\t`summary` text,\n\t`starts_at` text,\n\t`ends_at` text,\n\t`all_day` integer DEFAULT false NOT NULL,\n\t`due_at` text,\n\t`location` text,\n\t`assignee_contact_id` text,\n\t`status` text DEFAULT 'proposed' NOT NULL,\n\t`confidence` real,\n\t`missing_fields` text,\n\t`evidence` text,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\tFOREIGN KEY (`source_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`assignee_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action\n);",
      'CREATE INDEX `items_status_start_idx` ON `items` (`status`,`starts_at`);',
      'CREATE TABLE `messages` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`channel` text NOT NULL,\n\t`direction` text NOT NULL,\n\t`channel_msg_id` text NOT NULL,\n\t`from_phone` text,\n\t`type` text NOT NULL,\n\t`text` text,\n\t`media_path` text,\n\t`transcript` text,\n\t`created_at` text NOT NULL\n);',
      'CREATE UNIQUE INDEX `messages_channel_msg_uq` ON `messages` (`channel`,`channel_msg_id`);',
      "CREATE TABLE `owner` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`phone` text NOT NULL,\n\t`name` text NOT NULL,\n\t`tz` text DEFAULT 'America/Sao_Paulo' NOT NULL,\n\t`consent_at` text\n);",
      "CREATE TABLE `reminders` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`item_id` text NOT NULL,\n\t`remind_at` text NOT NULL,\n\t`status` text DEFAULT 'pending' NOT NULL,\n\t`delivered_via` text,\n\t`cloud_schedule_id` text,\n\t`attempts` integer DEFAULT 0 NOT NULL,\n\tFOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade\n);",
      'CREATE INDEX `reminders_status_at_idx` ON `reminders` (`status`,`remind_at`);',
      'CREATE TABLE `settings` (\n\t`key` text PRIMARY KEY NOT NULL,\n\t`value` text NOT NULL\n);',
      'CREATE TABLE `usage` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`at` text NOT NULL,\n\t`role` text NOT NULL,\n\t`model` text NOT NULL,\n\t`input_tokens` integer DEFAULT 0 NOT NULL,\n\t`output_tokens` integer DEFAULT 0 NOT NULL,\n\t`cost_usd` real DEFAULT 0 NOT NULL\n);',
      'CREATE INDEX `usage_at_idx` ON `usage` (`at`);',
    ],
  },
  {
    id: '0001_old_puppet_master',
    statements: [
      'CREATE TABLE `chat_log` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`at` text NOT NULL,\n\t`sender` text NOT NULL,\n\t`payload` text NOT NULL\n);',
      'CREATE INDEX `chat_log_at_idx` ON `chat_log` (`at`);',
    ],
  },
]
