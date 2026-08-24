CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todoId` integer NOT NULL,
	`key` text NOT NULL,
	`filename` text NOT NULL,
	`contentType` text NOT NULL,
	`size` integer NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`todoId`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_todo_id_idx` ON `attachments` (`todoId`);