import { describe, expect, it } from "vitest";

import { dueState } from "@/features/todos/due";

const task = (dueAt: string | null, status: "todo" | "done" = "todo") => ({ dueAt, status });

describe("dueState", () => {
  it("calls a past date overdue", () => {
    expect(dueState(task("2026-08-25"), "2026-08-26")).toBe("overdue");
  });

  it("distinguishes today from soon and later", () => {
    expect(dueState(task("2026-08-26"), "2026-08-26")).toBe("today");
    expect(dueState(task("2026-08-29"), "2026-08-26")).toBe("soon");
    expect(dueState(task("2026-08-30"), "2026-08-26")).toBe("later");
  });

  it("says nothing about a task with no due date", () => {
    expect(dueState(task(null), "2026-08-26")).toBe("none");
  });

  it("stops alarming once the task is done", () => {
    // A finished task that was late is history. Colouring it red would fill a
    // completed list with alarm about work nobody has to do.
    expect(dueState(task("2020-01-01", "done"), "2026-08-26")).toBe("none");
  });

  it("compares calendar dates as text, not as instants", () => {
    // Parsing these into Date objects invites the local-timezone shift that
    // moves a deadline to the day before for anyone west of Greenwich.
    expect(dueState(task("2026-12-31"), "2027-01-01")).toBe("overdue");
    expect(dueState(task("2027-01-01"), "2027-01-01")).toBe("today");
    // A year boundary is nothing special to a string comparison, which is the
    // point of using one.
    expect(dueState(task("2027-01-01"), "2026-12-31")).toBe("soon");
  });

  it("handles a soon window that crosses a month boundary", () => {
    expect(dueState(task("2026-09-01"), "2026-08-30")).toBe("soon");
    expect(dueState(task("2026-09-03"), "2026-08-30")).toBe("later");
  });
});
