import { describe, expect, it } from "vitest";

import { buildTimeline, dayNumber, isoFromDayNumber, monthSpans } from "@/features/todos/timeline";
import type { Todo } from "@/features/todos/types";

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: "task",
  status: "todo",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  projectId: 1,
  assigneeId: null,
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

    expect(isoFromDayNumber(from)).toBe("2026-11-02");
    // Three days: the 2nd, 3rd and 4th. An exclusive end would show two.
    expect(bars[0]).toMatchObject({ offset: 0, length: 3 });
  });

  it("marks a single day for a task with only one date", () => {
    // Inventing the other end would put a date on screen that nobody chose.
    const onlyDue = buildTimeline([todo({ dueAt: "2026-11-10" })], "2026-11-10");
    expect(onlyDue.bars[0]).toMatchObject({ offset: 0, length: 1 });

    const onlyStart = buildTimeline([todo({ startAt: "2026-11-10" })], "2026-11-10");
    expect(onlyStart.bars[0]).toMatchObject({ offset: 0, length: 1 });
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

  it("always keeps today on the axis", () => {
    // Otherwise a project entirely in the future opens somewhere with no
    // reference point for "now".
    const { from, todayOffset, days } = buildTimeline(
      [todo({ startAt: "2026-12-01", dueAt: "2026-12-05" })],
      "2026-11-20",
    );

    expect(isoFromDayNumber(from)).toBe("2026-11-20");
    expect(todayOffset).toBe(0);
    expect(days).toBe(16);
  });

  it("places today between tasks that straddle it", () => {
    const { todayOffset, bars } = buildTimeline(
      [
        todo({ id: 1, startAt: "2026-11-01", dueAt: "2026-11-03" }),
        todo({ id: 2, startAt: "2026-11-08", dueAt: "2026-11-09" }),
      ],
      "2026-11-05",
    );

    expect(todayOffset).toBe(4);
    expect(bars.map((b) => b.offset)).toEqual([0, 7]);
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
      180,
    );

    expect(days).toBe(180);
    expect(clipped).toBe(true);
  });

  it("drops nothing and claims no clipping when everything fits", () => {
    const { clipped, days } = buildTimeline(
      [todo({ startAt: "2026-11-01", dueAt: "2026-11-03" })],
      "2026-11-01",
      180,
    );

    expect(clipped).toBe(false);
    expect(days).toBe(3);
  });

  it("works with no tasks at all", () => {
    const { days, bars, todayOffset } = buildTimeline([], "2026-11-05");

    expect(bars).toEqual([]);
    expect(days).toBe(1);
    expect(todayOffset).toBe(0);
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
