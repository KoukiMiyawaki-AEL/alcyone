// Better Auth's tables live in ./auth-schema.ts and are re-exported so that
// drizzle-kit — which is pointed at this file alone — sees the whole schema.
export * from "./auth-schema";

import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth-schema";

export const projectsTable = sqliteTable(
  "projects",
  {
    id: int().primaryKey({ autoIncrement: true }),
    name: text().notNull(),
    createdAt: text().notNull(),
    // No `onDelete`: `projects` is referenced by `todos`, and D1 cannot disable
    // foreign key enforcement, so a cascade from `user` would silently delete
    // rows two levels down. See ADR 0012.
    ownerId: text()
      .notNull()
      .references(() => user.id),
    // Soft delete. Null means live. Every read filters on it, which is exactly
    // the kind of `where` that gets forgotten — so, like the owner filter, it
    // lives only in src/worker/db/repo.ts.
    deletedAt: text(),
  },
  (t) => [
    // Composite because every project query is `ownerId = ? AND deletedAt IS
    // NULL`. Load-bearing rather than speculative: D1 bills rows scanned, on a
    // database that runs one query at a time.
    index("projects_owner_id_idx").on(t.ownerId, t.deletedAt),
  ],
);

export const attachmentsTable = sqliteTable(
  "attachments",
  {
    id: int().primaryKey({ autoIncrement: true }),
    todoId: int()
      .notNull()
      .references(() => todosTable.id),
    /** Object key in R2. Opaque and unguessable — see the repo for why. */
    key: text().notNull(),
    filename: text().notNull(),
    contentType: text().notNull(),
    size: int().notNull(),
    createdAt: text().notNull(),
  },
  (t) => [index("attachments_todo_id_idx").on(t.todoId)],
);

export const todosTable = sqliteTable(
  "todos",
  {
    id: int().primaryKey({ autoIncrement: true }),
    title: text().notNull(),
    completed: int({ mode: "boolean" }).notNull().default(false),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
    // No `onDelete` on purpose. D1 cannot disable foreign key enforcement, so
    // a future migration that rebuilds `projects` would fire a CASCADE and
    // silently delete every todo. With the default NO ACTION the same
    // migration fails loudly instead. Deletion is done explicitly in a batch.
    projectId: int()
      .notNull()
      .references(() => projectsTable.id),
    /** ISO-8601 date (no time). Null means no due date. */
    dueAt: text(),
    /** 0 = none, 3 = highest. An integer so SQL can order by it directly. */
    priority: int().notNull().default(0),
    /** Soft delete. Null means live. See `projects.deletedAt`. */
    deletedAt: text(),
  },
  (t) => [
    // The FK check runs on every projects delete/update, and every todo list
    // query filters on projectId and deletedAt together.
    index("todos_project_id_idx").on(t.projectId, t.deletedAt),
  ],
);
