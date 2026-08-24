ALTER TABLE `todos` ADD `dueAt` text;--> statement-breakpoint
ALTER TABLE `todos` ADD `priority` integer DEFAULT 0 NOT NULL;