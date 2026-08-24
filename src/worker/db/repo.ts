import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";

import { type Cursor } from "./cursor";
import { ftsRank, toFtsQuery, toLikePattern, todosFts } from "./fts";
import {
  TODO_STATUSES,
  attachmentsTable,
  projectsTable,
  sharesTable,
  todosTable,
  type TodoStatus,
} from "./schema";

/**
 * Timestamps are generated here, not by the database.
 *
 * SQLite's `current_timestamp` produces `2026-08-23 12:44:13` — UTC, but not
 * ISO-8601, which `new Date()` then reads as local time. Generating them in
 * app code keeps one format that both SQL and JS agree on.
 */
const now = () => new Date().toISOString();

/**
 * What a list is narrowed to. Distinct from `TodoStatus` in the schema, which
 * is what a single row *is* — one of these ("active") is not a status at all
 * but "anything unfinished", and conflating the two is how a filter ends up
 * silently unable to express a state.
 */
export type TodoFilter = "all" | "active" | (typeof TODO_STATUSES)[number];
/**
 * The fields a caller may set on a todo. Optional throughout, and `null` where
 * clearing is meaningful — `undefined` means "leave it", `null` means "empty
 * it".
 */
export type TodoFields = {
  title?: string;
  status?: TodoStatus;
  startAt?: string | null;
  dueAt?: string | null;
  description?: string | null;
  priority?: number;
};

export type TodoSort = "created" | "due" | "priority" | "start";
export type TodoListOptions = {
  status?: TodoFilter;
  sort?: TodoSort;
  cursor?: Cursor | null;
  limit?: number;
};

/** The column a given sort orders by, and how to read it off a row. */
const sortColumn = {
  created: todosTable.id,
  due: todosTable.dueAt,
  start: todosTable.startAt,
  priority: todosTable.priority,
} as const;

export const todoCursorValue = (
  sort: TodoSort,
  row: { id: number; startAt: string | null; dueAt: string | null; priority: number },
) =>
  sort === "due"
    ? row.dueAt
    : sort === "start"
      ? row.startAt
      : sort === "priority"
        ? row.priority
        : row.id;

/**
 * "Everything after this position", expressed for the active sort.
 *
 * The `or` is the part that matters: rows sharing a sort value are separated by
 * id, so a page boundary that lands in the middle of a group neither repeats
 * nor skips them.
 */
function afterCursor(sort: TodoSort, cursor: Cursor): SQL | undefined {
  if (sort === "created") return gt(todosTable.id, cursor.id);

  const column = sortColumn[sort];
  if (sort === "priority") {
    // Descending, so "after" means a lower priority.
    return or(
      sql`${column} < ${cursor.value}`,
      and(eq(column, cursor.value as number), gt(todosTable.id, cursor.id)),
    );
  }

  // A date column ascending with nulls last — `due` and `start` behave
  // identically here. A null cursor is already in the trailing group, so only
  // ids can move it forward.
  if (cursor.value === null) {
    return and(sql`${column} is null`, gt(todosTable.id, cursor.id));
  }
  return or(
    sql`${column} is null`,
    sql`${column} > ${cursor.value}`,
    and(eq(column, cursor.value as string), gt(todosTable.id, cursor.id)),
  );
}

const statusFilter = (filter: TodoFilter = "all"): SQL | undefined => {
  if (filter === "all") return undefined;
  // "active" is every state except the terminal one, so it keeps meaning the
  // right thing when another state is added.
  if (filter === "active") return ne(todosTable.status, "done");
  return eq(todosTable.status, filter);
};

const sortOrder = (sort: TodoSort = "created"): SQL[] => {
  switch (sort) {
    case "due":
      // The first term is what pushes undated todos to the end. Left to
      // itself SQLite sorts NULL lowest, which would present "no deadline" as
      // the most urgent thing on the list.
      return [sql`${todosTable.dueAt} is null`, asc(todosTable.dueAt)];
    case "start":
      // Same nulls-last reasoning as `due`: a task with no start date is not
      // the one to begin with.
      return [sql`${todosTable.startAt} is null`, asc(todosTable.startAt)];
    case "priority":
      return [desc(todosTable.priority)];
    case "created":
      return [];
  }
};

/**
 * The single place `drizzle()` is constructed, the single place a query against
 * a table is written, and — since auth landed — the single place ownership is
 * enforced.
 *
 * **Every method here is already scoped to `ownerId`.** That is the point: a
 * handler cannot forget the filter because it never receives an unscoped query.
 * Getting this wrong produces no type error and no failing test; it produces one
 * user reading another user's rows.
 *
 * The same applies to soft deletion: every read also filters `deletedAt IS
 * NULL`, and that filter lives only here. Two invisible filters on every query
 * is exactly the situation this module exists to make un-forgettable.
 *
 * Note what that costs for todos. Todos have no owner column of their own —
 * ownership is transitive through their project — so the two flat routes
 * (`PATCH`/`DELETE /api/todos/:id`) must constrain through a subquery on
 * `projects`. Before auth those two matched on `todos.id` alone, which would
 * have let anyone walk the integer id space and edit other people's rows.
 *
 * D1 has no interactive transactions — `db.transaction()` type-checks and then
 * throws at runtime. The only atomicity primitive is `batch()`.
 *
 * IMPORTANT: these methods must never be `async`, and must not call `.all()` /
 * `.get()`. They return the *unexecuted* drizzle builder, which is both
 * awaitable (it extends QueryPromise) and usable as a `batch()` item. An
 * `async` wrapper would auto-await the builder and silently destroy the second
 * property.
 */
/**
 * `D1DatabaseSession` is accepted alongside `D1Database` because drizzle only
 * needs `prepare` and `batch`, which both provide. Handlers pass the session so
 * their reads are consistent with their own writes; the cron passes the plain
 * database, having no user whose writes to be consistent with.
 */
export function createRepo(binding: D1Database | D1DatabaseSession, ownerId: string) {
  const db = drizzle(binding as D1Database);

  /** This owner's project ids, as a subquery. Optionally narrowed to one id. */
  const ownedProjectIds = (id?: number) =>
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.ownerId, ownerId),
          isNull(projectsTable.deletedAt),
          id === undefined ? undefined : eq(projectsTable.id, id),
        ),
      );

  const shares = {
    find: (projectId: number) =>
      db
        .select()
        .from(sharesTable)
        .where(inArray(sharesTable.projectId, ownedProjectIds(projectId)))
        .limit(1),

    /**
     * Insert-from-select, so ownership is part of the statement rather than a
     * check the caller is trusted to have done.
     *
     * A plain insert passes the foreign key for *any* existing project, because
     * a foreign key checks existence and not ownership — which meant any signed
     * in user could mint a public link to a stranger's project. A test caught
     * it. The select yields no row when the project is not this owner's, so
     * nothing is inserted and the caller sees the same "not found" as for an id
     * that never existed.
     *
     * Written as SQL because drizzle's insert-select requires the selected
     * columns to match the table definition exactly, including the
     * autoincrement id — which would mean naming a column precisely to avoid
     * setting it.
     */
    create: (projectId: number, token: string) =>
      db.all<{ token: string }>(sql`
        insert into ${sharesTable} (token, "projectId", "createdAt")
        select ${token}, ${projectsTable.id}, ${now()}
        from ${projectsTable}
        where ${projectsTable.id} = ${projectId}
          and ${projectsTable.ownerId} = ${ownerId}
          and ${projectsTable.deletedAt} is null
        returning token
      `),

    remove: (projectId: number) =>
      db
        .delete(sharesTable)
        .where(inArray(sharesTable.projectId, ownedProjectIds(projectId)))
        .returning({ token: sharesTable.token }),
  };

  const projects = {
    list: (options: { cursor?: Cursor | null; limit?: number } = {}) =>
      db
        .select()
        .from(projectsTable)
        .where(
          and(
            eq(projectsTable.ownerId, ownerId),
            isNull(projectsTable.deletedAt),
            options.cursor ? gt(projectsTable.id, options.cursor.id) : undefined,
          ),
        )
        .orderBy(asc(projectsTable.id))
        .limit((options.limit ?? 0) + 1),

    find: (id: number) =>
      db
        .select()
        .from(projectsTable)
        .where(
          and(
            eq(projectsTable.id, id),
            eq(projectsTable.ownerId, ownerId),
            isNull(projectsTable.deletedAt),
          ),
        ),

    create: (values: { name: string }) =>
      db
        .insert(projectsTable)
        .values({ ...values, ownerId, createdAt: now() })
        .returning(),

    /** Soft delete. The row stays so it can be restored. */
    remove: (id: number) =>
      db
        .update(projectsTable)
        .set({ deletedAt: now() })
        .where(
          and(
            eq(projectsTable.id, id),
            eq(projectsTable.ownerId, ownerId),
            isNull(projectsTable.deletedAt),
          ),
        )
        .returning(),

    restore: (id: number) =>
      db.update(projectsTable).set({ deletedAt: null }).where(eq(projectsTable.id, id)).returning(),
  };

  const todos = {
    find: (id: number) =>
      db
        .select()
        .from(todosTable)
        .where(
          and(
            eq(todosTable.id, id),
            isNull(todosTable.deletedAt),
            inArray(todosTable.projectId, ownedProjectIds()),
          ),
        ),

    listByProject: (projectId: number, options: TodoListOptions = {}) =>
      db
        .select()
        .from(todosTable)
        .where(
          and(
            inArray(todosTable.projectId, ownedProjectIds(projectId)),
            isNull(todosTable.deletedAt),
            statusFilter(options.status),
            options.cursor ? afterCursor(options.sort ?? "created", options.cursor) : undefined,
          ),
        )
        // One more than asked for: the extra row is how the caller learns
        // whether another page exists without a second count query, which on
        // D1 would double the rows read.
        .limit((options.limit ?? 0) + 1)
        // Always a tiebreaker on id: without one, two todos with the same due
        // date or priority can swap places between requests, which looks like
        // the list is shuffling itself.
        .orderBy(...sortOrder(options.sort), asc(todosTable.id)),

    create: (values: TodoFields & { title: string; projectId: number }) => {
      const timestamp = now();
      return db
        .insert(todosTable)
        .values({ ...values, createdAt: timestamp, updatedAt: timestamp })
        .returning();
    },

    /**
     * Partial update. Only the keys present are written, so clearing a date
     * (`null`) and leaving it alone (absent) stay distinguishable — collapsing
     * them would make "remove the due date" impossible to express.
     */
    update: (id: number, values: TodoFields) =>
      db
        .update(todosTable)
        .set({ ...values, updatedAt: now() })
        .where(
          and(
            eq(todosTable.id, id),
            isNull(todosTable.deletedAt),
            inArray(todosTable.projectId, ownedProjectIds()),
          ),
        )
        .returning(),

    setStatus: (id: number, status: TodoStatus) =>
      db
        .update(todosTable)
        .set({ status, updatedAt: now() })
        .where(
          and(
            eq(todosTable.id, id),
            isNull(todosTable.deletedAt),
            inArray(todosTable.projectId, ownedProjectIds()),
          ),
        )
        .returning(),

    /** Soft delete. The row stays so it can be restored. */
    remove: (id: number) =>
      db
        .update(todosTable)
        .set({ deletedAt: now() })
        .where(
          and(
            eq(todosTable.id, id),
            isNull(todosTable.deletedAt),
            inArray(todosTable.projectId, ownedProjectIds()),
          ),
        )
        .returning(),

    restore: (id: number) =>
      db
        .update(todosTable)
        .set({ deletedAt: null })
        .where(and(eq(todosTable.id, id), inArray(todosTable.projectId, ownedProjectIds())))
        .returning(),

    /** Soft-deletes a project's todos alongside it. */
    removeByProject: (projectId: number) =>
      db
        .update(todosTable)
        .set({ deletedAt: now() })
        .where(
          and(
            inArray(todosTable.projectId, ownedProjectIds(projectId)),
            isNull(todosTable.deletedAt),
          ),
        ),

    restoreByProject: (projectId: number) =>
      db
        .update(todosTable)
        .set({ deletedAt: null })
        .where(inArray(todosTable.projectId, ownedProjectIds(projectId))),

    /**
     * Full-text search across every project this user owns.
     *
     * Two paths, one shape. `toFtsQuery` returns null when nothing the user
     * typed is long enough to match a trigram, and then this scans with LIKE
     * instead. That path is the expensive one — D1 bills rows scanned and LIKE
     * cannot use an index — which is exactly why it is the fallback and not
     * the implementation.
     *
     * Both are scoped through `ownedProjectIds()` like everything else here.
     * The index itself is not scoped: it holds every user's titles, so
     * forgetting the join would leak other people's todos. A test covers it.
     */
    search: (query: string, options: { cursor?: Cursor | null; limit?: number } = {}) => {
      const match = toFtsQuery(query);
      const limit = (options.limit ?? 0) + 1;

      if (match === null) {
        return (
          db
            // A constant rank so both paths hand back the same shape. The LIKE
            // path has no relevance to report, and pretending otherwise would be
            // worse than admitting every hit is equally good.
            .select({ ...getTableColumns(todosTable), rank: sql<number>`0` })
            .from(todosTable)
            .where(
              and(
                inArray(todosTable.projectId, ownedProjectIds()),
                isNull(todosTable.deletedAt),
                sql`${todosTable.title} LIKE ${toLikePattern(query)} ESCAPE '\\'`,
                options.cursor ? gt(todosTable.id, options.cursor.id) : undefined,
              ),
            )
            .limit(limit)
            .orderBy(asc(todosTable.id))
        );
      }

      return db
        .select({ ...getTableColumns(todosTable), rank: ftsRank })
        .from(todosTable)
        .innerJoin(todosFts, eq(todosFts.rowid, todosTable.id))
        .where(
          and(
            sql`${todosFts} MATCH ${match}`,
            inArray(todosTable.projectId, ownedProjectIds()),
            isNull(todosTable.deletedAt),
            // Keyset on relevance. Possible only because bm25() is usable in
            // WHERE, which was measured rather than assumed. The id tiebreak
            // matters more here than elsewhere: with trigrams, equal scores are
            // the common case, not the exception.
            options.cursor
              ? or(
                  gt(ftsRank, options.cursor.value),
                  and(eq(ftsRank, options.cursor.value), gt(todosTable.id, options.cursor.id)),
                )
              : undefined,
          ),
        )
        .limit(limit)
        .orderBy(asc(ftsRank), asc(todosTable.id));
    },
  };

  /**
   * Hard-deletes everything this owner has, soft-deleted rows included.
   *
   * This is the one place that ignores `deletedAt` — account deletion has to
   * mean deletion, or "delete my data" is a lie. Children first: `projects`
   * is referenced by `todos`, and D1 enforces the foreign key.
   *
   * Returns statements rather than running them, so the caller can put the
   * user row's own deletion in the same batch.
   */
  /** Every todo id owned by this user, ignoring soft-delete state. */
  const allOwnedTodoIds = () =>
    db
      .select({ id: todosTable.id })
      .from(todosTable)
      .where(
        inArray(
          todosTable.projectId,
          db
            .select({ id: projectsTable.id })
            .from(projectsTable)
            .where(eq(projectsTable.ownerId, ownerId)),
        ),
      );

  const purgeOwnedData = () =>
    [
      // Three levels now — attachments reference todos, todos reference
      // projects — so three statements in dependency order. The R2 objects are
      // not rows and survive this; see ownedAttachmentKeys.
      db.delete(attachmentsTable).where(inArray(attachmentsTable.todoId, allOwnedTodoIds())),
      db
        .delete(sharesTable)
        .where(
          inArray(
            sharesTable.projectId,
            db
              .select({ id: projectsTable.id })
              .from(projectsTable)
              .where(eq(projectsTable.ownerId, ownerId)),
          ),
        ),
      db
        .delete(todosTable)
        .where(
          inArray(
            todosTable.projectId,
            db
              .select({ id: projectsTable.id })
              .from(projectsTable)
              .where(eq(projectsTable.ownerId, ownerId)),
          ),
        ),
      db.delete(projectsTable).where(eq(projectsTable.ownerId, ownerId)),
    ] as const;

  /** Todo ids this owner may touch. Live todos only. */
  const ownedTodoIds = (todoId?: number) =>
    db
      .select({ id: todosTable.id })
      .from(todosTable)
      .where(
        and(
          inArray(todosTable.projectId, ownedProjectIds()),
          isNull(todosTable.deletedAt),
          todoId === undefined ? undefined : eq(todosTable.id, todoId),
        ),
      );

  const attachments = {
    listByTodo: (todoId: number) =>
      db
        .select()
        .from(attachmentsTable)
        .where(inArray(attachmentsTable.todoId, ownedTodoIds(todoId)))
        .orderBy(asc(attachmentsTable.id)),

    create: (values: {
      todoId: number;
      key: string;
      filename: string;
      contentType: string;
      size: number;
    }) =>
      db
        .insert(attachmentsTable)
        .values({ ...values, createdAt: now() })
        .returning(),

    find: (id: number) =>
      db
        .select()
        .from(attachmentsTable)
        .where(and(eq(attachmentsTable.id, id), inArray(attachmentsTable.todoId, ownedTodoIds()))),

    remove: (id: number) =>
      db
        .delete(attachmentsTable)
        .where(and(eq(attachmentsTable.id, id), inArray(attachmentsTable.todoId, ownedTodoIds())))
        .returning(),
  };

  return {
    projects,
    todos,
    shares,
    attachments,
    purgeOwnedData,
    /**
     * Every R2 key this owner has. Read this before `purgeOwnedData` runs.
     *
     * The object store is not part of the database, so deleting rows leaves the
     * files behind forever. Collecting the keys first is the only way to know
     * what to remove.
     */
    ownedAttachmentKeys: () =>
      db
        .select({ key: attachmentsTable.key })
        .from(attachmentsTable)
        .where(inArray(attachmentsTable.todoId, allOwnedTodoIds())),
    /**
     * Everything this owner has, for the data export.
     *
     * Deliberately ignores `deletedAt`, unlike every list method here. A user
     * asking for their data should get what the service actually holds, and
     * "we still have it but decided not to show you" is the wrong answer to
     * that question. Each row carries its own `deletedAt` so the state is
     * visible rather than hidden.
     *
     * Unpaginated on purpose. An export that stops at fifty rows is not an
     * export; the size limit this creates is handled by writing to R2 rather
     * than by returning less.
     */
    exportable: {
      projects: () => db.select().from(projectsTable).where(eq(projectsTable.ownerId, ownerId)),
      todos: () => db.select().from(todosTable).where(inArray(todosTable.id, allOwnedTodoIds())),
      attachments: () =>
        db
          .select()
          .from(attachmentsTable)
          .where(inArray(attachmentsTable.todoId, allOwnedTodoIds())),
    },
    /**
     * The only way to make more than one statement atomic on D1. Statements run
     * sequentially and non-concurrently; if any fails the whole sequence rolls
     * back. `db` itself is deliberately not exported so query construction
     * cannot scatter back out into the handlers.
     */
    batch: <U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(statements: T) =>
      db.batch(statements),
  };
}

export type Repo = ReturnType<typeof createRepo>;
