-- HAND-WRITTEN. drizzle-kit cannot express an FTS5 virtual table or a trigger,
-- so this file is outside its model — see migration 0009 and ADR 0018.
--
-- Widens the search index to cover `description`, which ADR 0024 added. A note
-- you cannot find is half a feature: the field exists to hold the detail that
-- did not fit in the title, which is exactly the text worth searching.
--
-- An FTS5 table's column set is fixed at creation, so this rebuilds it. The
-- index is derived data — every row can be reconstructed from `todos` — so
-- dropping it costs nothing but the time to fill it again.

DROP TRIGGER IF EXISTS todos_fts_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS todos_fts_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS todos_fts_update;--> statement-breakpoint
DROP TABLE IF EXISTS todos_fts;--> statement-breakpoint

-- Same tokenizer and the same reason: `unicode61` has nothing to split
-- Japanese on, so `設計ドキュメント` would be one token. Measured in ADR 0018.
CREATE VIRTUAL TABLE todos_fts USING fts5(
  title,
  description,
  tokenize='trigram',
  content='todos',
  content_rowid='id'
);--> statement-breakpoint

INSERT INTO todos_fts (rowid, title, description) SELECT id, title, description FROM todos;--> statement-breakpoint

CREATE TRIGGER todos_fts_insert AFTER INSERT ON todos BEGIN
  INSERT INTO todos_fts (rowid, title, description) VALUES (new.id, new.title, new.description);
END;--> statement-breakpoint

-- 'delete' rows must carry the OLD text of every indexed column: FTS5 removes
-- an entry by being told what was indexed, not by rowid alone. Passing the new
-- description here would strand the old terms in the index forever.
CREATE TRIGGER todos_fts_delete AFTER DELETE ON todos BEGIN
  INSERT INTO todos_fts (todos_fts, rowid, title, description)
  VALUES ('delete', old.id, old.title, old.description);
END;--> statement-breakpoint

CREATE TRIGGER todos_fts_update AFTER UPDATE ON todos BEGIN
  INSERT INTO todos_fts (todos_fts, rowid, title, description)
  VALUES ('delete', old.id, old.title, old.description);
  INSERT INTO todos_fts (rowid, title, description) VALUES (new.id, new.title, new.description);
END;
