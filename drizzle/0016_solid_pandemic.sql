-- Who is doing a task, as opposed to who owns the list it is on.
--
-- Nullable with no default, which is the form D1 accepts on a table that has
-- rows: ADR 0011 records that NOT NULL DEFAULT combined with REFERENCES fails
-- once the table is non-empty, and that it *succeeds* while it is empty — so
-- the safe form was confirmed against a populated table rather than assumed.
ALTER TABLE `todos` ADD `assigneeId` text REFERENCES user(id);