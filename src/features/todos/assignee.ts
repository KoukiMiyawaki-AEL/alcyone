import type { Assignee } from "./types";
/**
 * The name to show for a task's assignee.
 *
 * Resolved from the project's candidate list rather than from the signed-in
 * user: those are the same person today and will not be, and a lookup that
 * misses is more honest than one that assumes. An id with no match shows as
 * unknown rather than as unassigned — "someone we cannot name" and "nobody"
 * are different facts.
 */
export function assigneeName(assigneeId: string | null, assignees: Assignee[]): string | null {
  if (assigneeId === null) return null;
  return assignees.find((person) => person.id === assigneeId)?.name ?? "不明なユーザー";
}
