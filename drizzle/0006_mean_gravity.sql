DROP INDEX `projects_owner_id_idx`;--> statement-breakpoint
ALTER TABLE `projects` ADD `deletedAt` text;--> statement-breakpoint
CREATE INDEX `projects_owner_id_idx` ON `projects` (`ownerId`,`deletedAt`);--> statement-breakpoint
DROP INDEX `todos_project_id_idx`;--> statement-breakpoint
ALTER TABLE `todos` ADD `deletedAt` text;--> statement-breakpoint
CREATE INDEX `todos_project_id_idx` ON `todos` (`projectId`,`deletedAt`);