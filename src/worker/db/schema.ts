// Better Auth's tables live in ./auth-schema.ts and are re-exported so that
// drizzle-kit — which is pointed at this file alone — sees the whole schema.
export * from "./auth-schema";

import { sql } from "drizzle-orm";
import {
  check,
  index,
  int,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth-schema";

/**
 * The states a task can be in.
 *
 * Ordered as work moves through them, which is also the order they are offered
 * in the UI. `blocked` is deliberately not a terminal state — it is a reason
 * work stopped, not a way it ended.
 */
/**
 * What a history row can be about.
 *
 * The tracked fields are the ones a person schedules and reports against.
 * `description` is deliberately not here: a note is prose, and a history of
 * prose edits is noise that buries the changes worth seeing.
 */
/**
 * How two tasks can be connected.
 *
 * `blocks` is directional and `related` is not, which is why they are one
 * column and not two tables: the difference is what the row means, not what it
 * holds.
 */
export const TODO_LINK_KINDS = ["blocks", "related"] as const;
export type TodoLinkKind = (typeof TODO_LINK_KINDS)[number];

export const TODO_EVENT_FIELDS = [
  "created",
  "status",
  "assigneeId",
  "parentId",
  "startAt",
  "dueAt",
  "title",
  "priority",
  "deleted",
  "restored",
] as const;
export type TodoEventField = (typeof TODO_EVENT_FIELDS)[number];

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

/**
 * What a person wrote about a task.
 *
 * Separate from `todoEventsTable` on purpose. A comment is editable and
 * retractable — people make typos and say wrong things — while an audit trail
 * that can be edited is not an audit trail. Mixing them would cost the second
 * one its only real property.
 *
 * `authorId` rather than deriving it from the project's owner: today they are
 * always the same person, because a project has exactly one
 * (ADR 0014). Recording who wrote it anyway is what makes these comments
 * survive the day that stops being true — attributing them retroactively would
 * be guessing.
 */
export const todoCommentsTable = sqliteTable(
  "todo_comments",
  {
    id: int().primaryKey({ autoIncrement: true }),
    todoId: int()
      .notNull()
      .references(() => todosTable.id),
    authorId: text()
      .notNull()
      .references(() => user.id),
    body: text().notNull(),
    /**
     * The change this comment was written with, if it was written with one.
     *
     * Nullable, and the null carries meaning: a comment on its own is a remark
     * about the task, while one carrying a revision is the reason for that
     * change. The screen reads very differently for the two, so collapsing
     * them would lose the distinction the writer made.
     */
    revisionId: text(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
    /** Soft delete, like every other user-facing row (ADR 0015). */
    deletedAt: text(),
  },
  (t) => [index("todo_comments_todo_id_idx").on(t.todoId, t.deletedAt)],
);

/**
 * What happened to a task.
 *
 * Append-only: nothing updates or deletes a row here except the hard delete
 * that removes an account. A history that can be rewritten answers no question
 * worth asking.
 *
 * One row per field that actually changed, with the value it had and the value
 * it got. Storing a diff of the whole row would make "when did this become
 * blocked" a scan-and-parse instead of a query.
 */
export const todoEventsTable = sqliteTable(
  "todo_events",
  {
    id: int().primaryKey({ autoIncrement: true }),
    todoId: int()
      .notNull()
      .references(() => todosTable.id),
    actorId: text()
      .notNull()
      .references(() => user.id),
    /**
     * The single save these rows were written by.
     *
     * One update usually changes several fields at once, and showing those as
     * separate entries makes one action look like three. Not null: a history
     * row that belongs to no revision is a state with no meaning, and carrying
     * it would mean handling it forever.
     */
    revisionId: text().notNull(),
    /** The column that changed, or `created` / `deleted` / `restored`. */
    field: text().notNull().$type<TodoEventField>(),
    /** Null for `created`, and for a field that had no value before. */
    fromValue: text(),
    toValue: text(),
    createdAt: text().notNull(),
  },
  (t) => [index("todo_events_todo_id_idx").on(t.todoId, t.id)],
);

/**
 * A link between two tasks that is not the hierarchy.
 *
 * `related` is symmetric and stored once — writing both directions would be
 * two rows that can disagree. `blocks` is directional: `fromTodoId` blocks
 * `toTodoId`, which is the shape a schedule actually needs.
 *
 * The pair is unique per kind, as an index rather than a table constraint:
 * ADR 0011 records that drizzle's rebuild path re-emits indexes and silently
 * drops table-level UNIQUE.
 */
export const todoLinksTable = sqliteTable(
  "todo_links",
  {
    id: int().primaryKey({ autoIncrement: true }),
    fromTodoId: int()
      .notNull()
      .references((): AnySQLiteColumn => todosTable.id),
    toTodoId: int()
      .notNull()
      .references((): AnySQLiteColumn => todosTable.id),
    kind: text().notNull().$type<TodoLinkKind>(),
    createdAt: text().notNull(),
  },
  (t) => [
    uniqueIndex("todo_links_pair_uidx").on(t.fromTodoId, t.toTodoId, t.kind),
    index("todo_links_from_idx").on(t.fromTodoId),
    index("todo_links_to_idx").on(t.toTodoId),
    // A task related to itself says nothing and would render as a loop.
    check("todo_links_distinct", sql`${t.fromTodoId} <> ${t.toTodoId}`),
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
    /**
     * The task this one is part of. Null means it is top level.
     *
     * A column rather than a row in `todo_links`, because a task has at most
     * one parent and a column is what says so — expressing the hierarchy as
     * links would make "two parents" representable and then require a rule
     * nobody can see in the schema.
     *
     * Self-referencing with NO ACTION (ADR 0012), which has a consequence: a
     * hard delete has to detach children first, because SQLite checks the
     * foreign key row by row as it goes and would hit a child still pointing
     * at a parent it already removed.
     *
     * Cycles are not expressible as a constraint in SQLite, so they are
     * refused in the repository. See `wouldCycle`.
     */
    parentId: int().references((): AnySQLiteColumn => todosTable.id),
    /**
     * Who is doing this. Null means nobody has taken it.
     *
     * References `user` rather than being derived from the project's owner,
     * because "who owns the list" and "who is doing this task" are different
     * questions that happen to have the same answer while a project has one
     * person on it (ADR 0014).
     *
     * The candidate set is therefore exactly one person today, which makes the
     * field close to useless on its own — and it is still the field ADR 0026
     * named as a precondition for a real Gantt chart, and the one collaboration
     * needs to exist before anyone can be invited to anything.
     */
    assigneeId: text().references(() => user.id),
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
