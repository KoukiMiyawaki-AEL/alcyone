-- Three account roles instead of two, and a database-side domain for them.
--
-- `owner` is the instance's owner: an admin who can also appoint and remove
-- admins and owners, and the last of whom cannot be removed at all. A project's
-- owner is a different thing at a different scope (`projects.ownerId`) — the
-- screens call that one プロジェクトの作成者 to keep the two apart.
--
-- The domain is enforced with triggers rather than a CHECK constraint. SQLite
-- cannot add a constraint to an existing table, so a CHECK would mean
-- rebuilding `user` — and `session.userId` and `account.userId` reference it
-- ON DELETE CASCADE, so dropping the old table would silently delete every
-- session and every credential. A trigger gives the same guarantee without touching the rows.

CREATE TRIGGER user_role_known_insert
BEFORE INSERT ON user
WHEN NEW.role NOT IN ('member', 'admin', 'owner')
BEGIN
	SELECT RAISE(ABORT, 'unknown user role');
END;--> statement-breakpoint

CREATE TRIGGER user_role_known_update
BEFORE UPDATE OF role ON user
WHEN NEW.role NOT IN ('member', 'admin', 'owner')
BEGIN
	SELECT RAISE(ABORT, 'unknown user role');
END;--> statement-breakpoint

-- An installation that already has an administrator gets an owner: the first
-- one made, which is who the bootstrap would have chosen. An installation with
-- none needs nothing — its first account will become the owner on sign-up.
UPDATE user
   SET role = 'owner'
 WHERE role = 'admin'
   AND NOT EXISTS (SELECT 1 FROM user WHERE role = 'owner')
   AND id = (SELECT id FROM user WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);
