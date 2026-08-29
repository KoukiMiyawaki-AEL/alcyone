-- HAND-WRITTEN. drizzle-kit's generated version cannot be applied to D1.
--
-- Making `projects.ownerId` NOT NULL rebuilds `projects`, and `projects` is
-- referenced by `todos`. On D1 foreign keys are always enforced — PRAGMA
-- foreign_keys is a no-op there and defer_foreign_keys only moves the failure to
-- COMMIT — so the generated `DROP TABLE projects` fails outright. This is the
-- case predicted, and this file is the detach/reattach recipe it
-- prescribes, applied for the first time.
--
-- The generated PRAGMA foreign_keys lines are omitted deliberately: they do
-- nothing on D1, and leaving them in implies a protection that does not exist.
--
-- Do not add BEGIN/COMMIT: wrangler rejects migrations that open their own
-- transaction, and the file is already applied as a single batch.

-- 0. Projects that predate authentication have no owner, and no user exists to
--    inherit them. Delete them and their todos.
--
--    ONE-TIME, PRE-PRODUCTION ONLY. This is safe solely because
--    guarantees no D1 database has ever been created on a real Cloudflare
--    account, so the only rows anywhere are local development junk. DO NOT run
--    this migration against a database holding data anyone cares about; assign
--    the rows an owner instead. Seeding a placeholder user was considered and
--    rejected — a fake account that might be able to authenticate is worse than
--    deleting scratch data.
DELETE FROM `todos` WHERE `projectId` IN (SELECT `id` FROM `projects` WHERE `ownerId` IS NULL);--> statement-breakpoint
DELETE FROM `projects` WHERE `ownerId` IS NULL;--> statement-breakpoint

-- 1. Detach: rebuild `todos` without its foreign key so nothing references
--    `projects`.
CREATE TABLE `__detached_todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`projectId` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__detached_todos` ("id", "title", "completed", "createdAt", "updatedAt", "projectId")
SELECT "id", "title", "completed", "createdAt", "updatedAt", "projectId" FROM `todos`;--> statement-breakpoint
DROP TABLE `todos`;--> statement-breakpoint

-- 2. Nothing references `projects` now, so it can be rebuilt with ownerId
--    NOT NULL.
CREATE TABLE `__new_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`createdAt` text NOT NULL,
	`ownerId` text NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_projects` ("id", "name", "createdAt", "ownerId")
SELECT "id", "name", "createdAt", "ownerId" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE INDEX `projects_owner_id_idx` ON `projects` (`ownerId`);--> statement-breakpoint

-- 3. Reattach: restore `todos` with its foreign key and index.
CREATE TABLE `todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`projectId` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `todos` ("id", "title", "completed", "createdAt", "updatedAt", "projectId")
SELECT "id", "title", "completed", "createdAt", "updatedAt", "projectId" FROM `__detached_todos`;--> statement-breakpoint
DROP TABLE `__detached_todos`;--> statement-breakpoint
CREATE INDEX `todos_project_id_idx` ON `todos` (`projectId`);
