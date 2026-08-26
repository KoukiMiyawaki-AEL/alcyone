import type { projectsTable } from "@/worker/db/schema";

export type Project = typeof projectsTable.$inferSelect;

/**
 * A project as the dashboard needs it: the row plus its task counts, computed
 * in one statement alongside the name rather than one query per card.
 */
export type ProjectSummary = Project & {
  total: number;
  done: number;
  overdue: number;
  dueToday: number;
};
