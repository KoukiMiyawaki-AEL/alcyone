import { and, asc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";

import { projectsTable, todosTable } from "./schema";

/**
 * Timestamps are generated here, not by the database.
 *
 * SQLite's `current_timestamp` produces `2026-08-23 12:44:13` — UTC, but not
 * ISO-8601, which `new Date()` then reads as local time. Generating them in
 * app code keeps one format that both SQL and JS agree on.
 */
const now = () => new Date().toISOString();

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
        id === undefined
          ? eq(projectsTable.ownerId, ownerId)
          : and(eq(projectsTable.id, id), eq(projectsTable.ownerId, ownerId)),
      );

  const projects = {
    list: () =>
      db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.ownerId, ownerId))
        .orderBy(asc(projectsTable.id)),

    find: (id: number) =>
      db
        .select()
        .from(projectsTable)
        .where(and(eq(projectsTable.id, id), eq(projectsTable.ownerId, ownerId))),

    create: (values: { name: string }) =>
      db
        .insert(projectsTable)
        .values({ ...values, ownerId, createdAt: now() })
        .returning(),

    remove: (id: number) =>
      db
        .delete(projectsTable)
        .where(and(eq(projectsTable.id, id), eq(projectsTable.ownerId, ownerId)))
        .returning(),
  };

  const todos = {
    listByProject: (projectId: number) =>
      db
        .select()
        .from(todosTable)
        .where(inArray(todosTable.projectId, ownedProjectIds(projectId)))
        .orderBy(asc(todosTable.id)),

    create: (values: { title: string; projectId: number }) => {
      const timestamp = now();
      return db
        .insert(todosTable)
        .values({ ...values, createdAt: timestamp, updatedAt: timestamp })
        .returning();
    },

    setCompleted: (id: number, completed: boolean) =>
      db
        .update(todosTable)
        .set({ completed, updatedAt: now() })
        .where(and(eq(todosTable.id, id), inArray(todosTable.projectId, ownedProjectIds())))
        .returning(),

    remove: (id: number) =>
      db
        .delete(todosTable)
        .where(and(eq(todosTable.id, id), inArray(todosTable.projectId, ownedProjectIds())))
        .returning(),

    /** Children must go before the parent — see `projects.remove` in index.ts. */
    removeByProject: (projectId: number) =>
      db.delete(todosTable).where(inArray(todosTable.projectId, ownedProjectIds(projectId))),
  };

  return {
    projects,
    todos,
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
