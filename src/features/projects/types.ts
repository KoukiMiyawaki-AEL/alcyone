import type { LabelColor, projectsTable } from "@/worker/db/schema";

export type Project = typeof projectsTable.$inferSelect;

/** What a screen may set. Absent means "leave alone"; `null` clears. */
export type ProjectInput = {
  description?: string | null;
  color?: LabelColor;
  startAt?: string | null;
  dueAt?: string | null;
};

/**
 * A key suggested from a name: the leading letters and digits, uppercased.
 *
 * Only a suggestion — the field stays editable, because a name in Japanese
 * produces nothing here and a name like "Design system" produces DESIGNSYST,
 * which is not what anyone would have chosen.
 */
export function suggestKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

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
