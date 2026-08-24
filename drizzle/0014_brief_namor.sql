-- Comments on a task, and the history of what changed on it.
--
-- Two tables rather than one shared "activity" table. A comment is editable
-- and retractable; an audit trail that can be edited is not an audit trail.
-- One table would cost the second one the only property that makes it worth
-- having, and the merged feed the UI wants is a cheap merge of two queries.
--
-- Both reference `todos` and `user` with NO ACTION (ADR 0012), which means both
-- have to be deleted before the rows they point at. That has now been the cause
-- of one production-shaped bug (attachments, ADR 0019) and one near miss
-- (shares, ADR 0022), so the retention purge, the account purge and the test
-- reset all learn about these two in the same commit that creates them.

CREATE TABLE `todo_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todoId` integer NOT NULL,
	`authorId` text NOT NULL,
	`body` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`deletedAt` text,
	FOREIGN KEY (`todoId`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `todo_comments_todo_id_idx` ON `todo_comments` (`todoId`,`deletedAt`);--> statement-breakpoint
CREATE TABLE `todo_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todoId` integer NOT NULL,
	`actorId` text NOT NULL,
	`field` text NOT NULL,
	`fromValue` text,
	`toValue` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`todoId`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `todo_events_todo_id_idx` ON `todo_events` (`todoId`,`id`);