import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Query-side handle on the `todos_fts` virtual table (created in migration
 * 0009, widened to cover `description` in 0013).
 *
 * The columns here have to match the virtual table's, in order: `MATCH`
 * searches every indexed column, and the triggers name each one explicitly.
 *
 * Deliberately NOT exported from `schema.ts`. drizzle-kit reads only that file,
 * so keeping this out of it means the generator never learns the table exists —
 * which is what stops it from emitting a plain `CREATE TABLE todos_fts` that
 * would shadow the virtual one. The table is real; drizzle-kit just must not
 * own it.
 */
export const todosFts = sqliteTable("todos_fts", {
  rowid: integer("rowid").primaryKey(),
  title: text("title"),
  description: text("description"),
});

/**
 * Relevance. More negative is a better match, so ascending order puts the best
 * first — the opposite of what the word "rank" suggests.
 */
export const ftsRank = sql<number>`bm25(todos_fts)`;

/** Below this, a query cannot match a trigram at all. See */
export const MIN_FTS_TERM_LENGTH = 3;

/**
 * Turns whatever the user typed into an FTS5 query, or decides it cannot be one.
 *
 * Two separate jobs, both of which bite if skipped:
 *
 * 1. FTS5 has its own query language. Raw input containing `"`, `*`, `AND`, or
 *    `(` is parsed as syntax, so a user searching for `"` gets a 500 rather
 *    than no results. Quoting each token turns all of it back into text.
 * 2. Trigram cannot match anything shorter than three characters, so short
 *    tokens are dropped. If nothing survives, the caller must scan instead —
 *    signalled by returning null rather than by returning a query that
 *    silently finds nothing.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .filter((token) => token.length >= MIN_FTS_TERM_LENGTH)
    // Doubling `"` is how FTS5 escapes it inside a quoted phrase.
    .map((token) => `"${token.replaceAll('"', '""')}"`);

  // Space between phrases is an implicit AND, so every term must appear.
  return terms.length > 0 ? terms.join(" ") : null;
}

/** Escapes the wildcards in a LIKE pattern so they match literally. */
export function toLikePattern(input: string): string {
  return `%${input.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}
