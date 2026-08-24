-- Hierarchy and links between tasks.
--
-- `parentId` is a column and not a link row, because a task has at most one
-- parent and the column is what says so. `todo_links` holds the connections
-- that are genuinely many-to-many.
--
-- Both reference `todos` with NO ACTION (ADR 0012), and `parentId` references
-- it from inside itself. That self-reference has a consequence the purge paths
-- have to know about: SQLite checks a foreign key row by row, so deleting a
-- set of todos that point at each other fails unless the pointers are cleared
-- first. Handled in the same commit that creates the column rather than after
-- the nightly job falls over, which is how attachments were learned (ADR 0019).
--
-- Nullable with no default, which is the form D1 accepts on a populated table:
-- ADR 0011 records that NOT NULL DEFAULT plus REFERENCES fails once rows exist
-- and succeeds while they do not.

CREATE TABLE `todo_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fromTodoId` integer NOT NULL,
	`toTodoId` integer NOT NULL,
	`kind` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`fromTodoId`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`toTodoId`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "todo_links_distinct" CHECK("todo_links"."fromTodoId" <> "todo_links"."toTodoId")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `todo_links_pair_uidx` ON `todo_links` (`fromTodoId`,`toTodoId`,`kind`);--> statement-breakpoint
CREATE INDEX `todo_links_from_idx` ON `todo_links` (`fromTodoId`);--> statement-breakpoint
CREATE INDEX `todo_links_to_idx` ON `todo_links` (`toTodoId`);--> statement-breakpoint
ALTER TABLE `todos` ADD `parentId` integer REFERENCES todos(id);