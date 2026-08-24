import { createMaintenance } from "./db/maintenance";

/**
 * How long a soft-deleted row is kept before it is really gone.
 *
 * This is the retention policy in code: ADR 0015 chose soft deletion so a
 * misclick is recoverable, which only makes sense if "recoverable" has an end.
 * Without this the rows accumulate until the account is deleted, which
 * eventually meets D1's 10GB ceiling and its rows-scanned billing.
 */
export const RETENTION_DAYS = 30;

export async function purgeExpiredDeletions(env: CloudflareBindings, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [todos, projects] = await createMaintenance(env.DB).purgeDeletedBefore(cutoff);

  // Structured so the Workers dashboard can filter on it. A scheduled job that
  // logs nothing is indistinguishable from one that never ran.
  console.log(
    JSON.stringify({
      level: "info",
      message: "purged expired soft-deleted rows",
      cutoff,
      todos: todos.meta.changes,
      projects: projects.meta.changes,
    }),
  );

  return { cutoff, todos: todos.meta.changes, projects: projects.meta.changes };
}
