-- Project membership, and the role that governs who may grant it.
--
-- The owner is not a member row. Their access comes from `projects.ownerId`,
-- and duplicating it would create two facts that can disagree.
--
-- `role` goes on Better Auth's `user` table rather than into one of ours: a
-- separate table would let an account exist with no row in it and force every
-- check to decide what that means. Better Auth never writes this column, and
-- `updateUser` must never be handed it — a role is not the user's to set.
--
-- Every existing account becomes a `member`. There is no admin until one is
-- made deliberately, which is the right default for a column that grants power.

CREATE TABLE `project_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` integer NOT NULL,
	`userId` text NOT NULL,
	`addedBy` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`addedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_pair_uidx` ON `project_members` (`projectId`,`userId`);--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`userId`);--> statement-breakpoint
ALTER TABLE `user` ADD `role` text DEFAULT 'member' NOT NULL;