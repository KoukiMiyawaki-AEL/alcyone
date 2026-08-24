-- Expand half of replacing `completed` with `status` (ADR 0011).
--
-- The boolean stays for now and both are written; the contract migration drops
-- it once no code reads it. Doing it in one step would mean a deploy where the
-- running code and the schema disagree, in the direction that loses data.
--
-- All three are ADD COLUMN with a constant default, which D1 accepts. (The
-- form it rejects on a non-empty table is NOT NULL DEFAULT combined with
-- REFERENCES — recorded in ADR 0011.)
ALTER TABLE `todos` ADD `status` text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE `todos` ADD `startAt` text;--> statement-breakpoint
ALTER TABLE `todos` ADD `description` text;--> statement-breakpoint

-- Backfill. drizzle-kit cannot know the new column means anything in terms of
-- the old one, so without this every finished task silently comes back as
-- not-started — the rows are all still there, which is what makes it easy to
-- miss.
--
-- This fires the FTS update trigger once per row (delete + reinsert of the
-- same title). Harmless, but the reason the migration after this one has to
-- put those triggers back: they are what keeps search honest.
UPDATE `todos` SET `status` = 'done' WHERE `completed` = 1;--> statement-breakpoint

CREATE INDEX `todos_status_idx` ON `todos` (`projectId`,`deletedAt`,`status`);
