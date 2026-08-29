import { createMaintenance } from "./db/maintenance";
import { enqueueObjectCleanup, listKeys } from "./object-cleanup";

/**
 * How long a soft-deleted row is kept before it is really gone.
 *
 * This is the retention policy in code: chose soft deletion so a
 * misclick is recoverable, which only makes sense if "recoverable" has an end.
 * Without this the rows accumulate until the account is deleted, which
 * eventually meets D1's 10GB ceiling and its rows-scanned billing.
 */
export const RETENTION_DAYS = 30;

export async function purgeExpiredDeletions(env: CloudflareBindings, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const maintenance = createMaintenance(env.DB);

  // Read the keys before the rows go: nothing else knows an object exists, so
  // deleting the rows first would strand every file with no way to find it.
  const keys = (await maintenance.expiredAttachmentKeys(cutoff)).map((row) => row.key);

  // Handed off before the rows are deleted, and awaited. If this throws, the
  // rows stay and the next run tries again — the alternative is losing the
  // only record of which objects to delete.
  if (keys.length > 0) {
    await enqueueObjectCleanup(env.OBJECT_CLEANUP, keys);
  }

  // Exports hold a copy of everything the user had, so keeping them forever
  // would quietly undo both the retention policy and the soft-delete window
  // they were exported during. Found by age rather than by rows, because they
  // have none.
  const staleExports = await listKeys(
    env.ATTACHMENTS,
    "exports/",
    (object) => object.uploaded.toISOString() < cutoff,
  );
  if (staleExports.length > 0) {
    await enqueueObjectCleanup(env.OBJECT_CLEANUP, staleExports);
  }

  const { todos, projects } = await maintenance.purgeDeletedBefore(cutoff);
  // Counting the returned rows, not `meta.changes` — see maintenance.ts for
  // why that number cannot be believed once a trigger is in play.
  const counts = {
    todos: todos.length,
    projects: projects.length,
    objects: keys.length + staleExports.length,
  };

  // Structured so the Workers dashboard can filter on it. A scheduled job that
  // logs nothing is indistinguishable from one that never ran.
  console.log(
    JSON.stringify({
      level: "info",
      message: "purged expired soft-deleted rows",
      cutoff,
      ...counts,
    }),
  );

  return { cutoff, ...counts };
}
