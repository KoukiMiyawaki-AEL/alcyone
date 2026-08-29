import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  attachmentsTable,
  labelsTable,
  todoLabelsTable,
  todoLinksTable,
  projectsTable,
  sharesTable,
  todoCommentsTable,
  todoEventsTable,
  todosTable,
} from "./schema";

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
    /** The R2 keys about to lose their rows, read before anything is deleted. */
    expiredAttachmentKeys: (before: string) =>
      db
        .select({ key: attachmentsTable.key })
        .from(attachmentsTable)
        .where(
          inArray(
            attachmentsTable.todoId,
            db
              .select({ id: todosTable.id })
              .from(todosTable)
              .where(and(isNotNull(todosTable.deletedAt), lt(todosTable.deletedAt, before))),
          ),
        ),

    purgeDeletedBefore: async (before: string) => {
      /** The todos this run is about to remove, as a subquery. */
      const expiredTodoIds = db
        .select({ id: todosTable.id })
        .from(todosTable)
        .where(and(isNotNull(todosTable.deletedAt), lt(todosTable.deletedAt, before)));

      // Held in variables so their positions can be found rather than counted.
      // Three separate changes have added statements to this batch, and each
      // time the caller's hand-written indices silently pointed at the wrong
      // result. `indexOf` cannot drift.
      const deletedTodos = db
        .delete(todosTable)
        .where(and(isNotNull(todosTable.deletedAt), lt(todosTable.deletedAt, before)))
        .returning({ id: todosTable.id });
      const deletedProjects = db
        .delete(projectsTable)
        .where(and(isNotNull(projectsTable.deletedAt), lt(projectsTable.deletedAt, before)))
        .returning({ id: projectsTable.id });

      const statements = [
        // Attachments first. `attachments.todoId` references `todos.id` with NO
        // ACTION, so deleting a todo that still has one fails the
        // foreign key — and because this is a single batch, one such row made
        // the entire nightly purge fail for every user. It did exactly that
        // until a test was written for it.
        db.delete(attachmentsTable).where(inArray(attachmentsTable.todoId, expiredTodoIds)),
        // Children of `todos` first, for the same reason attachments are: a
        // NO ACTION foreign key fails the whole batch, and the batch is the
        // whole nightly job.
        // Links first, from either end.
        db
          .delete(todoLinksTable)
          .where(
            or(
              inArray(todoLinksTable.fromTodoId, expiredTodoIds),
              inArray(todoLinksTable.toTodoId, expiredTodoIds),
            ),
          ),
        db.delete(todoLabelsTable).where(inArray(todoLabelsTable.todoId, expiredTodoIds)),
        db.delete(todoCommentsTable).where(inArray(todoCommentsTable.todoId, expiredTodoIds)),
        db.delete(todoEventsTable).where(inArray(todoEventsTable.todoId, expiredTodoIds)),
        // Detach children whose parent is going, and children of a surviving
        // parent that is itself expiring. Row-by-row foreign key checks make
        // the order of a self-referencing delete matter.
        db
          .update(todosTable)
          .set({ parentId: null })
          .where(inArray(todosTable.parentId, expiredTodoIds)),
        db.update(todosTable).set({ parentId: null }).where(inArray(todosTable.id, expiredTodoIds)),
        deletedTodos,
        // Same shape of bug as the attachments one above, one table over:
        // `shares.projectId` references `projects.id`, so an expired project
        // with a live share link would fail the foreign key and take the whole
        // run with it. Written before it could happen rather than after.
        db.delete(sharesTable).where(
          inArray(
            sharesTable.projectId,
            db
              .select({ id: projectsTable.id })
              .from(projectsTable)
              .where(and(isNotNull(projectsTable.deletedAt), lt(projectsTable.deletedAt, before))),
          ),
        ),
        // A project's labels, after its todos are gone — `todo_labels` points at
        // both, and the same NO ACTION foreign key that has taken this batch
        // down twice would take it down again.
        db.delete(labelsTable).where(
          inArray(
            labelsTable.projectId,
            db
              .select({ id: projectsTable.id })
              .from(projectsTable)
              .where(and(isNotNull(projectsTable.deletedAt), lt(projectsTable.deletedAt, before))),
          ),
        ),
        deletedProjects,
      ] as const;

      const results = await db.batch(statements);

      return {
        todos: results[statements.indexOf(deletedTodos)] as { id: number }[],
        projects: results[statements.indexOf(deletedProjects)] as { id: number }[],
      };
    },
  };
}
