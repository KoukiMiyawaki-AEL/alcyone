-- HAND-WRITTEN. drizzle-kit's generated version of this migration cannot be
-- applied to D1 —
--
-- Two reasons it had to be rewritten:
--
-- 1. It rebuilt `projects` while `todos` still referenced it. On D1 foreign
--    keys are always enforced (PRAGMA foreign_keys is a no-op there, and each
--    migration runs as one batch = one transaction, so `defer_foreign_keys`
--    does not help either — the violation is still raised at commit). The
--    generated `DROP TABLE projects` therefore fails outright. Verified.
--    The fix is to detach the child, rebuild the parent, then reattach.
-- 2. drizzle-kit generates schema, never data. The `INSERT ... SELECT` steps
--    below carry the actual migration: seeding `updatedAt`, and converting
--    `createdAt` off SQLite's `current_timestamp` format.
--
-- `createdAt` was stored as `2026-08-23 12:44:13` — UTC, but not ISO-8601, so
-- `new Date()` read it as local time and was 9 hours out in JST. strftime
-- rewrites it in place, preserving the instant, and is idempotent on values
-- that are already converted.
--
-- Do not add BEGIN/COMMIT: wrangler rejects migrations that open their own
-- transaction, and the file is already applied as a single batch.

-- 1. Detach: rebuild `todos` without the foreign key, taking the opportunity
--    to apply every other change to it at the same time.
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
SELECT
	"id",
	"title",
	"completed",
	strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt"),
	strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt"),
	"projectId"
FROM `todos`;--> statement-breakpoint
DROP TABLE `todos`;--> statement-breakpoint

-- 2. Nothing references `projects` now, so it can be rebuilt.
CREATE TABLE `__new_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects` ("id", "name", "createdAt")
SELECT "id", "name", strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt") FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint

-- 3. Reattach: restore the foreign key and the index.
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
