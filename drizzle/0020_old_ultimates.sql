-- Labels: the axis a status column cannot express.
--
-- A task has exactly one status and exactly one assignee, so anything that
-- crosses those — "customer-reported", "needs design", "release 2.4" — had
-- nowhere to live. Many-to-many in both directions, hence a join table.
--
-- The colour is a fixed set rather than free-form hex. A palette keeps a board
-- readable, and each name maps to a design token that already has a light and a
-- dark value, so a label stays legible in both themes without anyone choosing
-- twice. The domain is a CHECK as well as a zod enum: the table is guarded on
-- every path in, including ones that never touch a handler.
--
-- `todo_labels` deliberately has no `createdAt`. The row is the fact; when
-- somebody attached it is not something any screen asks.

CREATE TABLE `labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "labels_color_known" CHECK("labels"."color" in ('slate','red','amber','green','blue','violet'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_project_name_uidx` ON `labels` (`projectId`,`name`);--> statement-breakpoint
CREATE INDEX `labels_project_idx` ON `labels` (`projectId`);--> statement-breakpoint
CREATE TABLE `todo_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todoId` integer NOT NULL,
	`labelId` integer NOT NULL,
	FOREIGN KEY (`todoId`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`labelId`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `todo_labels_pair_uidx` ON `todo_labels` (`todoId`,`labelId`);--> statement-breakpoint
CREATE INDEX `todo_labels_todo_idx` ON `todo_labels` (`todoId`);--> statement-breakpoint
CREATE INDEX `todo_labels_label_idx` ON `todo_labels` (`labelId`);