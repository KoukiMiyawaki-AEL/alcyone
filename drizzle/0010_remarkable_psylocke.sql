-- A read-only public link to one project. Both indexes are UNIQUE indexes
-- rather than table-level UNIQUE constraints: ADR 0011 records that drizzle's
-- table-rebuild path re-emits indexes but silently drops constraints, and a
-- share token that stopped being unique would hand two projects the same link.
CREATE TABLE `shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`projectId` integer NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_uidx` ON `shares` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_projectId_uidx` ON `shares` (`projectId`);