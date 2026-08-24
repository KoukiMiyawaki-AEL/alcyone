import { asc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";

import { projectsTable, todosTable } from "./schema";

/**
 * The single place `drizzle()` is constructed and the single place a query
 * against a table is written.
 *
 * Two reasons it exists rather than calling `drizzle(c.env.DB)` per handler:
 *
 * 1. When rows eventually gain an owner/tenant column, the `where` that scopes
 *    them belongs in exactly one file. Spread across handlers, forgetting one
 *    is a cross-tenant leak that no type error and no test would catch.
 * 2. D1 has no interactive transactions — `db.transaction()` type-checks and
 *    then throws at runtime. The only atomicity primitive is `batch()`.
 *
 * IMPORTANT: these methods must never be `async`, and must not call `.all()` /
 * `.get()`. They return the *unexecuted* drizzle builder, which is both
 * awaitable (it extends QueryPromise) and usable as a `batch()` item. An
 * `async` wrapper would auto-await the builder and silently destroy the second
 * property.
 */
export function createRepo(binding: D1Database) {
  const db = drizzle(binding);

  const projects = {
    list: () => db.select().from(projectsTable).orderBy(asc(projectsTable.id)),

    find: (id: number) => db.select().from(projectsTable).where(eq(projectsTable.id, id)),

    create: (values: { name: string }) => db.insert(projectsTable).values(values).returning(),

    remove: (id: number) => db.delete(projectsTable).where(eq(projectsTable.id, id)).returning(),
  };

  const todos = {
    listByProject: (projectId: number) =>
      db
        .select()
        .from(todosTable)
        .where(eq(todosTable.projectId, projectId))
        .orderBy(asc(todosTable.id)),

    create: (values: { title: string; projectId: number }) =>
      db.insert(todosTable).values(values).returning(),

    setCompleted: (id: number, completed: boolean) =>
      db.update(todosTable).set({ completed }).where(eq(todosTable.id, id)).returning(),

    remove: (id: number) => db.delete(todosTable).where(eq(todosTable.id, id)).returning(),

    /** Children must go before the parent — see `projects.remove` in index.ts. */
    removeByProject: (projectId: number) =>
      db.delete(todosTable).where(eq(todosTable.projectId, projectId)),
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
