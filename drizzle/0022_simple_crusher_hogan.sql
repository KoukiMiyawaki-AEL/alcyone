-- Project settings: the ones every task tool turns out to have.
--
-- Checked against three of them rather than guessed at. Jira's project details
-- are name, key, lead, default assignee and description; Asana's are name,
-- description, colour, dates and archived; Backlog's are name, project key and
-- archived. The intersection is what this adds — a key, a description, a
-- colour, a span, and archiving.
--
-- Every column arrives with a default or nullable, so this is six ALTERs and no
-- table rebuild. That matters here: `projects` is referenced by `todos`,
-- `shares`, `project_members` and `labels`, and SQLite checks foreign keys row
-- by row, so dropping and recreating it would fail on the first child row
-- (ADR 0011).
--
-- The `key` default of '' is the same story: SQLite cannot add a NOT NULL
-- column to a table with rows unless it has one. Nothing writes it — the
-- backfill below gives every existing project a real key, and the API requires
-- one from then on.

ALTER TABLE `projects` ADD `key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `description` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `color` text DEFAULT 'slate' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `startAt` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `dueAt` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `archivedAt` text;;--> statement-breakpoint

-- Existing projects get a key derived from their id: unique by construction,
-- and short. Deriving one from the name would need to handle collisions,
-- non-ASCII names, and names that produce nothing at all.
UPDATE projects SET key = 'P' || id WHERE key = '';--> statement-breakpoint

CREATE UNIQUE INDEX `projects_key_uidx` ON `projects` (`key`);--> statement-breakpoint

-- Domains as triggers, not CHECK constraints, for the reason above: a CHECK
-- cannot be added to an existing table without rebuilding it, and this table
-- cannot be rebuilt. Same trade as migration 0019 made for `user.role`.
CREATE TRIGGER projects_valid_insert
BEFORE INSERT ON projects
WHEN NEW.color NOT IN ('slate', 'red', 'amber', 'green', 'blue', 'violet')
  OR NEW.key = ''
  OR NEW.key GLOB '*[^A-Z0-9_]*'
  OR (NEW.startAt IS NOT NULL AND NEW.dueAt IS NOT NULL AND NEW.startAt > NEW.dueAt)
BEGIN
	SELECT RAISE(ABORT, 'invalid project');
END;--> statement-breakpoint

CREATE TRIGGER projects_valid_update
BEFORE UPDATE ON projects
WHEN NEW.color NOT IN ('slate', 'red', 'amber', 'green', 'blue', 'violet')
  OR NEW.key = ''
  OR NEW.key GLOB '*[^A-Z0-9_]*'
  OR (NEW.startAt IS NOT NULL AND NEW.dueAt IS NOT NULL AND NEW.startAt > NEW.dueAt)
BEGIN
	SELECT RAISE(ABORT, 'invalid project');
END;
