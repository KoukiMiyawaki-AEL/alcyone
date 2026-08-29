-- HAND-WRITTEN. drizzle-kit's generated version cannot be applied to D1.
--
-- Contract half of replacing `completed` with `status`: drop the boolean and
-- add the CHECK constraints. Dropping a column rebuilds `todos`, and `todos` is
-- referenced by `attachments`, so this is's detach/reattach recipe for
-- the second time.
--
-- The generated PRAGMA foreign_keys lines are omitted: they do nothing on D1.
--
-- Two things were measured before writing this, and both are worth knowing.
--
-- 1. The generated version APPLIES CLEANLY when `attachments` is empty and
--    fails with FOREIGN KEY constraint failed when it holds even one row. A
--    foreign key is checked per row, not per table, so local development and
--    CI — where that table is usually empty at this moment — would have passed
--    this forever and it would have failed on the first database with a real
--    attachment in it. A foreign key is checked row by row, so an empty
--    child table proves nothing.
--
-- 2. The rebuild DROPS THE THREE FTS TRIGGERS, exactly as predicted,
--    and `todos_fts` keeps its rows — so search goes on answering, with results
--    that quietly stop matching the table. Nothing errors. They are recreated
--    at the end of this file, and test/worker/migrations.test.ts fails if they
--    are ever missing again.

-- 1. Detach: rebuild `attachments` without its foreign key, so nothing
--    references `todos`.
CREATE TABLE `__detached_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todoId` integer NOT NULL,
	`key` text NOT NULL,
	`filename` text NOT NULL,
	`contentType` text NOT NULL,
	`size` integer NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__detached_attachments` ("id", "todoId", "key", "filename", "contentType", "size", "createdAt")
SELECT "id", "todoId", "key", "filename", "contentType", "size", "createdAt" FROM `attachments`;--> statement-breakpoint
DROP TABLE `attachments`;--> statement-breakpoint

-- 2. Nothing references `todos` now, so it can be rebuilt without `completed`
--    and with the constraints.
--
--    The CHECKs are here rather than only in zod because validation sees one
--    request: a PATCH that moves `startAt` cannot compare it to a `dueAt` it
--    was not given. Only the database sees the whole row.
CREATE TABLE `__new_todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`projectId` integer NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`startAt` text,
	`dueAt` text,
	`description` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`deletedAt` text,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "todos_status_known" CHECK("__new_todos"."status" in ('todo', 'in_progress', 'blocked', 'done')),
	CONSTRAINT "todos_dates_ordered" CHECK("__new_todos"."startAt" is null or "__new_todos"."dueAt" is null or "__new_todos"."startAt" <= "__new_todos"."dueAt")
);
--> statement-breakpoint
INSERT INTO `__new_todos` ("id", "title", "createdAt", "updatedAt", "projectId", "status", "startAt", "dueAt", "description", "priority", "deletedAt")
SELECT "id", "title", "createdAt", "updatedAt", "projectId", "status", "startAt", "dueAt", "description", "priority", "deletedAt" FROM `todos`;--> statement-breakpoint
DROP TABLE `todos`;--> statement-breakpoint
ALTER TABLE `__new_todos` RENAME TO `todos`;--> statement-breakpoint
CREATE INDEX `todos_project_id_idx` ON `todos` (`projectId`,`deletedAt`);--> statement-breakpoint
CREATE INDEX `todos_status_idx` ON `todos` (`projectId`,`deletedAt`,`status`);--> statement-breakpoint

-- 3. Reattach: restore `attachments` with its foreign key and index.
CREATE TABLE `__new_attachments` (
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
INSERT INTO `__new_attachments` ("id", "todoId", "key", "filename", "contentType", "size", "createdAt")
SELECT "id", "todoId", "key", "filename", "contentType", "size", "createdAt" FROM `__detached_attachments`;--> statement-breakpoint
DROP TABLE `__detached_attachments`;--> statement-breakpoint
ALTER TABLE `__new_attachments` RENAME TO `attachments`;--> statement-breakpoint
CREATE INDEX `attachments_todo_id_idx` ON `attachments` (`todoId`);
--> statement-breakpoint

-- 4. Put the FTS triggers back.
--
--    `DROP TABLE todos` took them with it, and nothing else would have said
--    so: `todos_fts` keeps its rows and answers searches with stale results.
--    test/worker/migrations.test.ts asserts the triggers are here.
--
--    Identical to migration 0009. Duplicated rather than factored out because
--    a migration has to keep saying what it said when it ran; a shared
--    definition that someone later edits would rewrite history.
CREATE TRIGGER todos_fts_insert AFTER INSERT ON todos BEGIN
  INSERT INTO todos_fts (rowid, title) VALUES (new.id, new.title);
END;--> statement-breakpoint

-- 'delete' rows carry the OLD text: FTS5 removes an entry by being told what
-- was indexed, not by rowid alone.
CREATE TRIGGER todos_fts_delete AFTER DELETE ON todos BEGIN
  INSERT INTO todos_fts (todos_fts, rowid, title) VALUES ('delete', old.id, old.title);
END;--> statement-breakpoint

CREATE TRIGGER todos_fts_update AFTER UPDATE ON todos BEGIN
  INSERT INTO todos_fts (todos_fts, rowid, title) VALUES ('delete', old.id, old.title);
  INSERT INTO todos_fts (rowid, title) VALUES (new.id, new.title);
END;
