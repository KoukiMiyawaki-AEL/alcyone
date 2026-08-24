import { and, isNotNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { projectsTable, todosTable } from "./schema";

/**
 * Queries that run without a user.
 *
 * Deliberately separate from `createRepo`. That one takes an `ownerId` and
 * scopes everything to it, which is the whole reason nobody can leak another
 * user's rows — and a scheduled job has no user to scope to. Rather than adding
 * an "unscoped" escape hatch there and hoping nobody reaches for it from a
 * request handler, unscoped work lives in its own module with its own name.
 */
export function createMaintenance(binding: D1Database) {
  const db = drizzle(binding);

  return {
    /**
     * Hard-deletes rows soft-deleted before `before` (an ISO-8601 instant).
     *
     * Children first: `projects` is referenced by `todos`, and D1 enforces the
     * foreign key. Batched for the same reason project deletion is — D1 has no
     * interactive transactions, and half a purge is worse than none.
     *
     * `.returning()` rather than reading `meta.changes`, because that count
     * stopped being trustworthy the moment `todos` grew a trigger: measured on
     * D1, deleting 2 todos and 1 project inside one batch reported 6 and 5.
     * Trigger writes are counted, and inside a batch they are not even
     * attributed to the statement that caused them. The returned rows are the
     * rows, and they cost no extra scan to obtain.
     */
    purgeDeletedBefore: (before: string) =>
      db.batch([
        db
          .delete(todosTable)
          .where(and(isNotNull(todosTable.deletedAt), lt(todosTable.deletedAt, before)))
          .returning({ id: todosTable.id }),
        db
          .delete(projectsTable)
          .where(and(isNotNull(projectsTable.deletedAt), lt(projectsTable.deletedAt, before)))
          .returning({ id: projectsTable.id }),
      ]),
  };
}
