import { describe, expect, it } from "vitest";

import {
  LEAD_DAYS,
  MIN_DAYS,
  applyDrag,
  buildTimeline,
  dayNumber,
  isoFromDayNumber,
  days,
  monthSpans,
} from "@/features/todos/timeline";
import type { Todo } from "@/features/todos/types";

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: "task",
  status: "todo",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  projectId: 1,
  assigneeId: null,
  parentId: null,
  deletedAt: null,
  startAt: null,
  dueAt: null,
  description: null,
  priority: 0,
  ...over,
});

describe("calendar dates", () => {
  it("round-trips a date without moving it", () => {
    // The bug this guards against shifts a due date to the day before it for
    // anyone west of Greenwich, and only for them.
    for (const iso of ["2026-01-01", "2026-06-15", "2026-12-31", "2027-03-01"]) {
      expect(isoFromDayNumber(dayNumber(iso)), iso).toBe(iso);
    }
  });

  it("counts days across a month boundary", () => {
    expect(dayNumber("2026-03-01") - dayNumber("2026-02-28")).toBe(1);
  });

  it("counts days across a leap day", () => {
    expect(dayNumber("2028-03-01") - dayNumber("2028-02-28")).toBe(2);
  });
});

describe("buildTimeline", () => {
  it("spans a task from its start to its due date, inclusive", () => {
    const { bars, from } = buildTimeline(
      [todo({ startAt: "2026-11-02", dueAt: "2026-11-04" })],
      "2026-11-02",
    );

    // The axis opens `LEAD_DAYS` before today, so the bar sits that far in.
    expect(isoFromDayNumber(from)).toBe("2026-10-26");
    // Three days: the 2nd, 3rd and 4th. An exclusive end would show two.
    expect(bars[0]).toMatchObject({ offset: LEAD_DAYS, length: 3 });
  });

  it("marks a single day for a task with only one date", () => {
    // Inventing the other end would put a date on screen that nobody chose.
    const onlyDue = buildTimeline([todo({ dueAt: "2026-11-10" })], "2026-11-10");
    expect(onlyDue.bars[0]).toMatchObject({ offset: LEAD_DAYS, length: 1 });

    const onlyStart = buildTimeline([todo({ startAt: "2026-11-10" })], "2026-11-10");
    expect(onlyStart.bars[0]).toMatchObject({ offset: LEAD_DAYS, length: 1 });
  });

  it("hands back tasks with no dates instead of dropping them", () => {
    // An axis of dates has no place for them, but silently losing tasks would
    // make the view lie about what the project contains.
    const { bars, unscheduled } = buildTimeline(
      [todo({ id: 1, dueAt: "2026-11-10" }), todo({ id: 2, title: "no dates" })],
      "2026-11-10",
    );

    expect(bars).toHaveLength(1);
    expect(unscheduled.map((t) => t.title)).toEqual(["no dates"]);
  });

  it("always keeps today on the axis, with room before it", () => {
    // Otherwise a project entirely in the future opens with no reference point
    // for "now", and a task that started last week is pinned to the very edge.
    const { from, todayOffset } = buildTimeline(
      [todo({ startAt: "2026-12-01", dueAt: "2026-12-05" })],
      "2026-11-20",
    );

    expect(isoFromDayNumber(from)).toBe("2026-11-13");
    expect(todayOffset).toBe(LEAD_DAYS);
  });

  it("draws a calendar wider than the work, so empty stretches are visible", () => {
    // Sizing the axis to the tasks makes a two-task project rescale every time
    // a date moves, and you cannot see that a month is free if the month is
    // not drawn.
    const { days } = buildTimeline(
      [todo({ startAt: "2026-11-02", dueAt: "2026-11-04" })],
      "2026-11-02",
    );

    expect(days).toBe(MIN_DAYS);
  });

  it("grows past the minimum when the work needs it", () => {
    const { days } = buildTimeline(
      [todo({ startAt: "2026-11-02", dueAt: "2027-01-31" })],
      "2026-11-02",
      { minDays: 30, maxDays: 365 },
    );

    // 7 lead days plus the task's own span.
    expect(days).toBeGreaterThan(90);
  });

  it("shows a calendar even with no tasks at all", () => {
    // An empty project still has a schedule to plan against.
    const { days, bars, todayOffset } = buildTimeline([], "2026-11-05");

    expect(bars).toEqual([]);
    expect(days).toBe(MIN_DAYS);
    expect(todayOffset).toBe(LEAD_DAYS);
  });

  it("places today between tasks that straddle it", () => {
    const { todayOffset, bars } = buildTimeline(
      [
        todo({ id: 1, startAt: "2026-11-01", dueAt: "2026-11-03" }),
        todo({ id: 2, startAt: "2026-11-08", dueAt: "2026-11-09" }),
      ],
      "2026-11-05",
    );

    // The axis opens `LEAD_DAYS` before today, and both tasks start after that
    // point — so today sits at the lead and the bars fall where they fall.
    expect(todayOffset).toBe(LEAD_DAYS);
    expect(bars.map((b) => b.offset)).toEqual([3, 10]);
  });

  it("orders bars by when they start", () => {
    const { bars } = buildTimeline(
      [
        todo({ id: 1, title: "later", startAt: "2026-11-10", dueAt: "2026-11-11" }),
        todo({ id: 2, title: "earlier", startAt: "2026-11-01", dueAt: "2026-11-02" }),
      ],
      "2026-11-01",
    );

    expect(bars.map((b) => b.todo.title)).toEqual(["earlier", "later"]);
  });

  it("clips an absurd range and says that it did", () => {
    const { days, clipped } = buildTimeline(
      [todo({ startAt: "2026-01-01", dueAt: "2030-01-01" })],
      "2026-01-01",
      { maxDays: 180 },
    );

    expect(days).toBe(180);
    expect(clipped).toBe(true);
  });

  it("claims no clipping when everything fits", () => {
    const { clipped } = buildTimeline(
      [todo({ startAt: "2026-11-01", dueAt: "2026-11-03" })],
      "2026-11-01",
    );

    expect(clipped).toBe(false);
  });
});

describe("monthSpans", () => {
  it("groups the axis into months", () => {
    const from = dayNumber("2026-01-30");
    expect(monthSpans(from, 5)).toEqual([
      { label: "2026/01", span: 2 },
      { label: "2026/02", span: 3 },
    ]);
  });
});

describe("dragging a bar", () => {
  it("shifts both ends and keeps the duration", () => {
    expect(applyDrag({ startAt: "2026-11-02", dueAt: "2026-11-06" }, "move", 3)).toEqual({
      startAt: "2026-11-05",
      dueAt: "2026-11-09",
    });
  });

  it("shifts backwards across a month boundary", () => {
    expect(applyDrag({ startAt: "2026-03-02", dueAt: "2026-03-03" }, "move", -3)).toEqual({
      startAt: "2026-02-27",
      dueAt: "2026-02-28",
    });
  });

  it("moves only the date a one-ended task has", () => {
    // Inventing the other end would set a date nobody chose.
    expect(applyDrag({ startAt: null, dueAt: "2026-11-10" }, "move", 2)).toEqual({
      startAt: null,
      dueAt: "2026-11-12",
    });
  });

  it("moves one edge when an edge is dragged", () => {
    expect(applyDrag({ startAt: "2026-11-02", dueAt: "2026-11-06" }, "start", 2)).toEqual({
      startAt: "2026-11-04",
      dueAt: "2026-11-06",
    });
    expect(applyDrag({ startAt: "2026-11-02", dueAt: "2026-11-06" }, "end", -2)).toEqual({
      startAt: "2026-11-02",
      dueAt: "2026-11-04",
    });
  });

  it("will not let a bar invert", () => {
    // The database refuses it with a CHECK, and finding out after the drop is
    // a worse way to learn it than not being able to do it.
    expect(applyDrag({ startAt: "2026-11-02", dueAt: "2026-11-06" }, "start", 10)).toEqual({
      startAt: "2026-11-06",
      dueAt: "2026-11-06",
    });
    expect(applyDrag({ startAt: "2026-11-02", dueAt: "2026-11-06" }, "end", -10)).toEqual({
      startAt: "2026-11-02",
      dueAt: "2026-11-02",
    });
  });

  it("leaves an edge alone when the task has no date for it", () => {
    expect(applyDrag({ startAt: null, dueAt: "2026-11-06" }, "start", 3)).toEqual({
      startAt: null,
      dueAt: "2026-11-06",
    });
    expect(applyDrag({ startAt: "2026-11-06", dueAt: null }, "end", 3)).toEqual({
      startAt: "2026-11-06",
      dueAt: null,
    });
  });

  it("changes nothing for a drag of zero columns", () => {
    // A click that does not move must not be a write: it would churn
    // `updatedAt` and tell every other tab to refetch for nothing.
    const dates = { startAt: "2026-11-02", dueAt: "2026-11-06" };
    expect(applyDrag(dates, "move", 0)).toEqual(dates);
  });
});

describe("day columns", () => {
  it("labels each column with its day of the month", () => {
    const from = dayNumber("2026-01-30");
    expect(days(from, 3, "2026-01-30").map((d) => d.label)).toEqual(["30", "31", "1"]);
  });

  it("marks Saturdays and Sundays", () => {
    // 2026-11-07 is a Saturday. Read in UTC, because the whole axis is — the
    // local getter would shift which column counts as the weekend for anyone
    // who is not on UTC.
    const from = dayNumber("2026-11-05");
    expect(days(from, 5, "2026-11-05").map((d) => d.weekend)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it("marks exactly one column as today", () => {
    const from = dayNumber("2026-11-05");
    const marked = days(from, 10, "2026-11-08").filter((d) => d.isToday);

    expect(marked.map((d) => d.iso)).toEqual(["2026-11-08"]);
  });
});
