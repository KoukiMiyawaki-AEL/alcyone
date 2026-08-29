-- `project_members.addedBy` を NULL 可にする。
--
-- 退会したアカウントが、他人のプロジェクトに誰かを追加していた場合、その行は
-- 「もういない人が追加した」状態になる。行そのものは消せない——**それは別の人の
-- アクセス権**であって、追加した人が去ったからといって無効になるわけではない。
-- 消せるのは「誰が追加したか」という情報だけなので、この列をNULL可にする。
--
-- SQLiteはNOT NULLを外せないのでテーブルの作り直しになる。`project_members` は
-- **どのテーブルからも参照されていない**ので、この1つだけは安全に作り直せる
-- （`user` や `projects` は作り直せない。docs/design/data-model.md 参照）。
--
-- `PRAGMA foreign_keys=OFF` はD1では効かない。効かなくても通る：削除するテーブルを
-- 指す外部キーが無く、コピー先への挿入は既に存在する行だけを入れるため。

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` integer NOT NULL,
	`userId` text NOT NULL,
	`addedBy` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`addedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_project_members`("id", "projectId", "userId", "addedBy", "createdAt") SELECT "id", "projectId", "userId", "addedBy", "createdAt" FROM `project_members`;--> statement-breakpoint
DROP TABLE `project_members`;--> statement-breakpoint
ALTER TABLE `__new_project_members` RENAME TO `project_members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_pair_uidx` ON `project_members` (`projectId`,`userId`);--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`userId`);