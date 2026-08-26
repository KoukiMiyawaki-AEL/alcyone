import { TODO_STATUSES } from "@/worker/db/schema";

import { dueState } from "./due";
import { STATUS_LABELS, type Assignee, type Label, type LabelledTodo } from "./types";

export type Bucket = { key: string; label: string; count: number };

export type Overview = {
  total: number;
  done: number;
  /** 0–100, rounded. Zero tasks is not zero percent — the caller checks `total`. */
  percent: number;
  byStatus: Bucket[];
  byAssignee: Bucket[];
  /** The chip itself, not just its name: the colour is half of what it says. */
  byLabel: { key: string; label: Label; count: number }[];
  overdue: LabelledTodo[];
  dueSoon: LabelledTodo[];
  unscheduled: number;
};

/**
 * What a project looks like right now, from the rows already on the page.
 *
 * A pure function of its inputs — including `today`, which is passed in rather
 * than read from the clock, so the same rows always produce the same summary
 * and none of this needs a fake timer to test.
 *
 * Deliberately not a second query. Every number here is derived from the same
 * rows the other views show, which means the summary and the list can never
 * disagree about a project. The cost is that it summarises the page that was
 * loaded, not the whole project — the screen says so rather than leaving it to
 * be discovered.
 */
export function buildOverview(
  todos: LabelledTodo[],
  labels: Label[],
  assignees: Assignee[],
  today: string,
): Overview {
  const done = todos.filter((todo) => todo.status === "done").length;

  const byStatus = TODO_STATUSES.map((status) => ({
    key: status,
    label: STATUS_LABELS[status],
    count: todos.filter((todo) => todo.status === status).length,
  }));

  // Unassigned is a bucket, not an omission: "nobody is holding this" is the
  // most actionable thing a load breakdown can say.
  const byAssignee = [
    ...assignees.map((person) => ({
      key: person.id,
      label: person.name,
      count: todos.filter((todo) => todo.assigneeId === person.id && todo.status !== "done").length,
    })),
    {
      key: "__unassigned__",
      label: "未割り当て",
      count: todos.filter((todo) => todo.assigneeId === null && todo.status !== "done").length,
    },
  ].filter((bucket) => bucket.count > 0);

  const byLabel = labels
    .map((label) => ({
      key: String(label.id),
      label,
      count: todos.filter((todo) => todo.labels.some((l) => l.id === label.id)).length,
    }))
    .filter((bucket) => bucket.count > 0);

  return {
    total: todos.length,
    done,
    percent: todos.length === 0 ? 0 : Math.round((done / todos.length) * 100),
    byStatus,
    byAssignee,
    byLabel,
    overdue: todos.filter((todo) => dueState(todo, today) === "overdue"),
    dueSoon: todos.filter((todo) => {
      const state = dueState(todo, today);
      return state === "today" || state === "soon";
    }),
    unscheduled: todos.filter((todo) => todo.status !== "done" && !todo.startAt && !todo.dueAt)
      .length,
  };
}
