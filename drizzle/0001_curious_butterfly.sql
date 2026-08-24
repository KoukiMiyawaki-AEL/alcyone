CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`createdAt` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
-- Hand-written: drizzle-kit generates schema, never data.
-- Explicit id so the backfill below and the tests have something stable to
-- reference; SQLite advances sqlite_sequence accordingly, so the next insert
-- gets 2. A literal timestamp rather than current_timestamp keeps the
-- migration deterministic and replayable.
INSERT INTO `projects` (`id`, `name`, `createdAt`) VALUES (1, 'Inbox', '2026-08-24T00:00:00.000Z');--> statement-breakpoint
ALTER TABLE `todos` ADD `projectId` integer REFERENCES projects(id);--> statement-breakpoint
-- Hand-written backfill. This is the "expand" half of expand/contract: the
-- column stays nullable so the currently-deployed Worker, which inserts todos
-- without a projectId, keeps working until the new code is deployed.
UPDATE `todos` SET `projectId` = 1 WHERE `projectId` IS NULL;--> statement-breakpoint
CREATE INDEX `todos_project_id_idx` ON `todos` (`projectId`);
