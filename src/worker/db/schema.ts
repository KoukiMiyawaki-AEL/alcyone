import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectsTable = sqliteTable("projects", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  createdAt: text()
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const todosTable = sqliteTable(
  "todos",
  {
    id: int().primaryKey({ autoIncrement: true }),
    title: text().notNull(),
    completed: int({ mode: "boolean" }).notNull().default(false),
    createdAt: text()
      .notNull()
      .default(sql`(current_timestamp)`),
    // Nullable for now — the contract migration makes it NOT NULL. On D1 this
    // is the only form `ALTER TABLE ADD COLUMN` accepts: with foreign keys
    // enforced (which D1 always does), a REFERENCES column may not carry a
    // non-NULL default, and a NOT NULL column may not carry a NULL one.
    //
    // No `onDelete` on purpose. D1 cannot disable foreign key enforcement, so
    // a future migration that rebuilds `projects` would fire a CASCADE and
    // silently delete every todo. With the default NO ACTION the same
    // migration fails loudly instead. Deletion is done explicitly in a batch.
    projectId: int().references(() => projectsTable.id),
  },
  (t) => [
    // The FK check runs on every projects delete/update, and every todo list
    // query filters on this. Unindexed, both become full scans — and D1 bills
    // rows *scanned*, on a database that processes queries one at a time.
    index("todos_project_id_idx").on(t.projectId),
  ],
);
