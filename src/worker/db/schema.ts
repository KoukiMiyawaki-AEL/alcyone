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
  },
  (t) => [
    // Every project query filters on the owner, so this index is load-bearing
    // rather than speculative: D1 bills rows scanned, one query at a time.
    index("projects_owner_id_idx").on(t.ownerId),
  ],
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
  },
  (t) => [
    // The FK check runs on every projects delete/update, and every todo list
    // query filters on this. Unindexed, both become full scans — and D1 bills
    // rows *scanned*, on a database that processes queries one at a time.
    index("todos_project_id_idx").on(t.projectId),
  ],
);
