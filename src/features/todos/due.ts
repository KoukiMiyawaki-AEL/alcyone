import type { Todo } from "./types";

/**
 * How a due date should read.
 *
 * The most actionable fact in a task list is that something is late, and until
 * now a date in the past rendered exactly like a date next month — the reader
 * had to compare every row against today's date themselves. Nielsen Norman's
 * scanning research is blunt about how much of that actually happens: most
 * people scan rather than read, so a fact that requires arithmetic to notice is
 * a fact nobody notices.
 *
 * `done` deliberately has no state. A finished task that was late is history,
 * and colouring it red would fill a completed list with alarm about work
 * nobody needs to do.
 */
export type DueState = "overdue" | "today" | "soon" | "later" | "none";

/** Within this many days counts as "soon" — roughly the rest of the week. */
const SOON_DAYS = 3;

export function dueState(todo: Pick<Todo, "dueAt" | "status">, today: string): DueState {
  if (todo.dueAt === null || todo.status === "done") return "none";

  // String comparison, because both are ISO calendar dates. Parsing them into
  // Date objects would invite the local-timezone shift that moves a deadline to
  // the day before for anyone west of Greenwich.
  if (todo.dueAt < today) return "overdue";
  if (todo.dueAt === today) return "today";

  const soonest = new Date(`${today}T00:00:00Z`);
  soonest.setUTCDate(soonest.getUTCDate() + SOON_DAYS);
  return todo.dueAt <= soonest.toISOString().slice(0, 10) ? "soon" : "later";
}

/** Text colour for a due date, in the same vocabulary everywhere it appears. */
export const DUE_TEXT: Record<DueState, string> = {
  overdue: "text-destructive font-medium",
  today: "text-primary font-medium",
  soon: "text-foreground",
  later: "text-muted-foreground",
  none: "text-muted-foreground",
};

/** What the state means, for a label rather than a colour alone. */
export const DUE_LABEL: Record<DueState, string> = {
  overdue: "期限切れ",
  today: "本日期限",
  soon: "まもなく期限",
  later: "期限",
  none: "期限",
};
