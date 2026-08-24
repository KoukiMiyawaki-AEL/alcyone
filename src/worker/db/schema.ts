// Better Auth's tables live in ./auth-schema.ts and are re-exported so that
// drizzle-kit — which is pointed at this file alone — sees the whole schema.
export * from "./auth-schema";

import { sql } from "drizzle-orm";
import { check, index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth-schema";

/**
 * The states a task can be in.
 *
 * Ordered as work moves through them, which is also the order they are offered
 * in the UI. `blocked` is deliberately not a terminal state — it is a reason
 * work stopped, not a way it ended.
 */
export const TODO_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

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

/**
 * A read-only public link to one project.
 *
 * A table rather than a column on `projects` because `projects` is a parent
 * table, and D1 cannot rebuild one (ADR 0011) — a new table costs nothing and
 * keeps that door shut. It also makes revocation a delete rather than a nulled
 * column, so there is no "was it ever shared" ambiguity.
 *
 * D1 is the authority on whether a link exists; KV only caches what it renders.
 */
export const sharesTable = sqliteTable(
  "shares",
  {
    id: int().primaryKey({ autoIncrement: true }),
    /** Random and unguessable — this is the only thing protecting the view. */
    token: text().notNull(),
    projectId: int()
      .notNull()
      .references(() => projectsTable.id),
    createdAt: text().notNull(),
  },
  (table) => [
    uniqueIndex("shares_token_uidx").on(table.token),
    // One live link per project, so revoking is unambiguous.
    uniqueIndex("shares_projectId_uidx").on(table.projectId),
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
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
    // No `onDelete` on purpose. D1 cannot disable foreign key enforcement, so
    // a future migration that rebuilds `projects` would fire a CASCADE and
    // silently delete every todo. With the default NO ACTION the same
    // migration fails loudly instead. Deletion is done explicitly in a batch.
    projectId: int()
      .notNull()
      .references(() => projectsTable.id),
    /**
     * Where the task is, not whether it is finished.
     *
     * Replaced a `completed` boolean, which migration 0012 dropped. A boolean
     * cannot say "started" or "blocked", and adding those as separate flags
     * would let a row claim to be both at once. The set is pinned by a CHECK
     * below, so a value the application does not know cannot be stored at all.
     *
     * Stored as text rather than an integer so the value is readable in a
     * query result and in an export; the set is small and fixed, so the space
     * cost is irrelevant next to being able to read what a row says.
     */
    status: text().notNull().default("todo").$type<TodoStatus>(),
    /** ISO-8601 date (no time). Null means not scheduled to start. */
    startAt: text(),
    /** ISO-8601 date (no time). Null means no due date. */
    dueAt: text(),
    /** Free text. Null and empty are the same thing to a reader, so writes normalise to null. */
    description: text(),
    /** 0 = none, 3 = highest. An integer so SQL can order by it directly. */
    priority: int().notNull().default(0),
    /** Soft delete. Null means live. See `projects.deletedAt`. */
    deletedAt: text(),
  },
  (t) => [
    // The FK check runs on every projects delete/update, and every todo list
    // query filters on projectId and deletedAt together.
    index("todos_project_id_idx").on(t.projectId, t.deletedAt),
    // Every list query filters by project and deletion; most now also filter
    // by status. Without status in the index that last predicate is a scan
    // over the project's rows, and D1 bills what it scans.
    index("todos_status_idx").on(t.projectId, t.deletedAt, t.status),
    // Constraints rather than validation alone. Zod can only see one request:
    // a PATCH that moves `startAt` cannot check it against a `dueAt` it was
    // not given. The database sees the whole row, so this is the only place
    // the rule can be true of every row rather than of every request.
    check("todos_status_known", sql`${t.status} in ('todo', 'in_progress', 'blocked', 'done')`),
    check(
      "todos_dates_ordered",
      sql`${t.startAt} is null or ${t.dueAt} is null or ${t.startAt} <= ${t.dueAt}`,
    ),
  ],
);
