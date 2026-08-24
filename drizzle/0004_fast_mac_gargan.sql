ALTER TABLE `projects` ADD `ownerId` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `projects_owner_id_idx` ON `projects` (`ownerId`);