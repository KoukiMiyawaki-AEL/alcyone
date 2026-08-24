-- Full-text search over todo titles.
--
-- Hand-written, like 0002 and 0005, because drizzle-kit cannot express an FTS5
-- virtual table or a trigger. That is not a workaround; it has a consequence
-- worth knowing: `drizzle/meta/*_snapshot.json` will never contain these
-- objects, so `drizzle-kit generate` neither drops nor recreates them. They are
-- invisible to it, which is safe here and dangerous in one specific case
-- recorded in docs/adr/0018-fts5-trigram-search.md — a rebuild of `todos`
-- drops the triggers with it, silently, and the index then rots.
-- test/worker/migrations.test.ts asserts they exist so that regression is loud.

-- `tokenize='trigram'` rather than the default `unicode61`.
--
-- The default splits on non-alphanumeric characters, which means Japanese text
-- has no boundaries to split on: `設計ドキュメントを書く` becomes one token and
-- searching for `設計` finds nothing. Measured, not assumed. Trigram indexes
-- every three-character sequence instead, so substring search works for
-- Japanese and English alike (`pagina` finds `pagination`).
--
-- The cost is a hard floor: a query shorter than three characters cannot match
-- a trigram at all. The application falls back to a scan for those; see the ADR.
--
-- `content='todos'` keeps the text in `todos` rather than storing it twice; this
-- table holds only the index.
CREATE VIRTUAL TABLE todos_fts USING fts5(
  title,
  tokenize='trigram',
  content='todos',
  content_rowid='id'
);

-- Backfill. The table is created after rows already exist.
INSERT INTO todos_fts (rowid, title) SELECT id, title FROM todos;

-- An external-content FTS5 table is not maintained automatically — without
-- these three triggers it is correct exactly once, at creation, and then drifts
-- from `todos` forever while still answering queries.
--
-- Soft-deleted rows deliberately stay in the index. `deletedAt IS NULL` is
-- applied when joining back to `todos`, so the index does not need to know
-- about deletion, and a restore does not need to touch it.
CREATE TRIGGER todos_fts_insert AFTER INSERT ON todos BEGIN
  INSERT INTO todos_fts (rowid, title) VALUES (new.id, new.title);
END;

-- 'delete' rows carry the OLD text: FTS5 removes an entry by being told what
-- was indexed, not by rowid alone. Passing the new title here would leave the
-- old terms in the index permanently.
CREATE TRIGGER todos_fts_delete AFTER DELETE ON todos BEGIN
  INSERT INTO todos_fts (todos_fts, rowid, title) VALUES ('delete', old.id, old.title);
END;

CREATE TRIGGER todos_fts_update AFTER UPDATE ON todos BEGIN
  INSERT INTO todos_fts (todos_fts, rowid, title) VALUES ('delete', old.id, old.title);
  INSERT INTO todos_fts (rowid, title) VALUES (new.id, new.title);
END;
