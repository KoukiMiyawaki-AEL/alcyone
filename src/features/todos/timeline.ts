import type { Todo } from "./types";

/**
 * Dates on a todo are calendar dates — "2026-11-01", no time, no zone.
 *
 * Everything here works in UTC and never converts to local, because a
 * conversion is what turns a due date into the day before it for anyone west
 * of Greenwich. `new Date("2026-11-01")` already parses as UTC midnight; the
 * trap is `new Date(y, m, d)` and `toLocaleDateString`, which do not.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const dayNumber = (iso: string): number =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) /
  MS_PER_DAY;

export const isoFromDayNumber = (day: number): string =>
  new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

/** A task placed on the timeline: which day it starts, and how many it spans. */
export type Bar = { todo: Todo; offset: number; length: number };

export type Timeline = {
  /** Inclusive first day of the axis. */
  from: number;
  /** Number of columns. */
  days: number;
  bars: Bar[];
  /** Tasks with no dates at all — they have no place on an axis of dates. */
  unscheduled: Todo[];
  /** Column index of today, or null when today is off the axis. */
  todayOffset: number | null;
  /** True when the range was clipped to `maxDays`. */
  clipped: boolean;
};

/**
 * Arranges todos onto a day axis.
 *
 * A task with both dates is a bar. A task with one is a single day — showing
 * it as a bar of invented length would put a start date on screen that nobody
 * chose. A task with neither is not on the axis at all, and is handed back
 * separately so the caller can say so rather than quietly dropping it.
 */
export function buildTimeline(todos: Todo[], today: string, maxDays = 180): Timeline {
  const scheduled = todos.filter((todo) => todo.startAt || todo.dueAt);
  const unscheduled = todos.filter((todo) => !todo.startAt && !todo.dueAt);

  const spans = scheduled.map((todo) => {
    // With one date, both ends are that date: a single-day mark.
    const start = dayNumber(todo.startAt ?? todo.dueAt!);
    const end = dayNumber(todo.dueAt ?? todo.startAt!);
    // A start after a due date is refused by a CHECK constraint, so this only
    // guards against a row that predates it.
    return { todo, start: Math.min(start, end), end: Math.max(start, end) };
  });

  const todayDay = dayNumber(today);
  // Today is always on the axis, so "where are we" needs no scrolling to answer
  // even when every task is in the future.
  const first = Math.min(todayDay, ...spans.map((s) => s.start));
  const last = Math.max(todayDay, ...spans.map((s) => s.end));

  const from = Number.isFinite(first) ? first : todayDay;
  const fullDays = (Number.isFinite(last) ? last : todayDay) - from + 1;
  const days = Math.min(fullDays, maxDays);

  return {
    from,
    days,
    bars: spans
      .sort((a, b) => a.start - b.start || a.todo.id - b.todo.id)
      .map(({ todo, start, end }) => ({
        todo,
        offset: start - from,
        length: end - start + 1,
      }))
      // A bar that starts past the clipped edge has nowhere to go.
      .filter((bar) => bar.offset < days),
    unscheduled,
    todayOffset: todayDay - from < days ? todayDay - from : null,
    clipped: fullDays > maxDays,
  };
}

/** Month boundaries within the axis, for the header row. */
export function monthSpans(from: number, days: number): { label: string; span: number }[] {
  const out: { label: string; span: number }[] = [];

  for (let i = 0; i < days; i++) {
    const iso = isoFromDayNumber(from + i);
    const label = `${iso.slice(0, 4)}/${iso.slice(5, 7)}`;
    const last = out.at(-1);
    if (last?.label === label) last.span += 1;
    else out.push({ label, span: 1 });
  }

  return out;
}

/** What a drag is doing to a bar. */
export type DragMode = "move" | "start" | "end";

export type DragResult = { startAt: string | null; dueAt: string | null };

/**
 * Turns a drag of `deltaDays` columns into the dates it produces.
 *
 * The objection ADR 0026 raised against editing here was that turning pixels
 * back into dates puts a deadline the user never touched at risk. The answer is
 * that the axis is a fixed grid: a column is exactly one day, so the conversion
 * is integer division with no rounding to be wrong about. What remains is
 * making the rules explicit, which is what this function is.
 *
 * - `move` shifts both ends, keeping the duration. A task with one date shifts
 *   that one; inventing the other would set a date nobody chose.
 * - `start` and `end` move one edge and are clamped so the bar cannot invert —
 *   a CHECK constraint would reject it anyway, and failing after the drop is a
 *   worse way to learn it than not being able to do it.
 */
export function applyDrag(
  todo: { startAt: string | null; dueAt: string | null },
  mode: DragMode,
  deltaDays: number,
): DragResult {
  const shift = (iso: string | null) =>
    iso === null ? null : isoFromDayNumber(dayNumber(iso) + deltaDays);

  if (mode === "move") {
    return { startAt: shift(todo.startAt), dueAt: shift(todo.dueAt) };
  }

  if (mode === "start") {
    // Nothing to drag when there is no start date; the bar is a single-day
    // mark and its one edge is the other one.
    if (todo.startAt === null) return { startAt: null, dueAt: todo.dueAt };
    const moved = dayNumber(todo.startAt) + deltaDays;
    const limit = todo.dueAt === null ? Infinity : dayNumber(todo.dueAt);
    return { startAt: isoFromDayNumber(Math.min(moved, limit)), dueAt: todo.dueAt };
  }

  if (todo.dueAt === null) return { startAt: todo.startAt, dueAt: null };
  const moved = dayNumber(todo.dueAt) + deltaDays;
  const limit = todo.startAt === null ? -Infinity : dayNumber(todo.startAt);
  return { startAt: todo.startAt, dueAt: isoFromDayNumber(Math.max(moved, limit)) };
}
