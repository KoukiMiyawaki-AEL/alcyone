-- HAND-WRITTEN. Groups history rows into the save that wrote them.
--
-- One update usually changes several fields, and until now each one was its own
-- entry — three separate lines for a single action. A revision id is what makes
-- "changed the status, the due date and the priority" one thing on screen.
--
-- Written as expand-and-contract inside one file rather than across two
-- deploys, which is a departure from and needs its reason stated: the
-- concept and its column are being introduced in the same change, no code
-- outside this commit writes to `todo_events`, and still holds — no
-- D1 database has ever existed on a real Cloudflare account. On a deployed
-- system these would be two migrations with a deploy between them.
ALTER TABLE `todo_events` ADD `revisionId` text;--> statement-breakpoint

-- Every existing row was its own action, which is exactly what it was: one
-- field, one save. Giving each its own id preserves that rather than inventing
-- groupings that never happened.
UPDATE `todo_events` SET `revisionId` = 'legacy-' || `id`;--> statement-breakpoint

-- Contract. `todo_events` is a leaf — nothing references it and it carries no
-- triggers — so the plain rebuild works here, unlike the `todos` rebuild in
-- 0012 which needed detach/reattach and lost the FTS triggers.
CREATE TABLE `__new_todo_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todoId` integer NOT NULL,
	`actorId` text NOT NULL,
	`revisionId` text NOT NULL,
	`field` text NOT NULL,
	`fromValue` text,
	`toValue` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`todoId`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_todo_events` ("id", "todoId", "actorId", "revisionId", "field", "fromValue", "toValue", "createdAt")
SELECT "id", "todoId", "actorId", "revisionId", "field", "fromValue", "toValue", "createdAt" FROM `todo_events`;--> statement-breakpoint
DROP TABLE `todo_events`;--> statement-breakpoint
ALTER TABLE `__new_todo_events` RENAME TO `todo_events`;--> statement-breakpoint
CREATE INDEX `todo_events_todo_id_idx` ON `todo_events` (`todoId`,`id`);--> statement-breakpoint

-- Nullable on comments, and the null means something: a comment on its own is a
-- remark, a comment carrying a revision is the reason for that change.
ALTER TABLE `todo_comments` ADD `revisionId` text;
