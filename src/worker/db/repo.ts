import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";

import { attachmentsTable, projectsTable, todosTable } from "./schema";

/**
 * Timestamps are generated here, not by the database.
 *
 * SQLite's `current_timestamp` produces `2026-08-23 12:44:13` — UTC, but not
 * ISO-8601, which `new Date()` then reads as local time. Generating them in
 * app code keeps one format that both SQL and JS agree on.
 */
const now = () => new Date().toISOString();

export type TodoStatus = "all" | "active" | "done";
export type TodoSort = "created" | "due" | "priority";
export type TodoListOptions = { status?: TodoStatus; sort?: TodoSort };

const statusFilter = (status: TodoStatus = "all"): SQL | undefined =>
  status === "all" ? undefined : eq(todosTable.completed, status === "done");

const sortOrder = (sort: TodoSort = "created"): SQL[] => {
  switch (sort) {
    case "due":
      // The first term is what pushes undated todos to the end. Left to
      // itself SQLite sorts NULL lowest, which would present "no deadline" as
      // the most urgent thing on the list.
      return [sql`${todosTable.dueAt} is null`, asc(todosTable.dueAt)];
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
export function createRepo(binding: D1Database, ownerId: string) {
  const db = drizzle(binding);

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

  const projects = {
    list: () =>
      db
        .select()
        .from(projectsTable)
        .where(and(eq(projectsTable.ownerId, ownerId), isNull(projectsTable.deletedAt)))
        .orderBy(asc(projectsTable.id)),

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
          ),
        )
        // Always a tiebreaker on id: without one, two todos with the same due
        // date or priority can swap places between requests, which looks like
        // the list is shuffling itself.
        .orderBy(...sortOrder(options.sort), asc(todosTable.id)),

    create: (values: { title: string; projectId: number; dueAt?: string; priority?: number }) => {
      const timestamp = now();
      return db
        .insert(todosTable)
        .values({ ...values, createdAt: timestamp, updatedAt: timestamp })
        .returning();
    },

    update: (id: number, values: { dueAt?: string | null; priority?: number }) =>
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

    setCompleted: (id: number, completed: boolean) =>
      db
        .update(todosTable)
        .set({ completed, updatedAt: now() })
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
