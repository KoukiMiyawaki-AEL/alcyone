-- Gives an owner to an installation that has accounts but nobody in charge.
--
-- Migration 0019 promoted "the first administrator" — which covers an
-- installation that already had one, and misses the one this was actually
-- written for. The `role` column arrived in 0018 with `DEFAULT 'member'` and no
-- way to change it, so every database created between 0018 and 0019 has
-- accounts, no administrator, and no owner. And since the role can only be
-- granted by someone who holds it, such an installation cannot make one: the
-- bootstrap in src/worker/auth.ts only fires when the table is empty, which it
-- is not.
--
-- Found on a real database rather than by reading 0019 again.
--
-- The earliest account, which is who the bootstrap would have chosen. A fresh
-- database has no rows here yet, so this does nothing and the bootstrap still
-- decides — as it should.

UPDATE user
   SET role = 'owner'
 WHERE NOT EXISTS (SELECT 1 FROM user WHERE role = 'owner')
   AND id = (SELECT id FROM user ORDER BY created_at, id LIMIT 1);
