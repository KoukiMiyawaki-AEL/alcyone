import { describe, expect, it } from "vitest";

import { buildOverview } from "@/features/todos/overview";
import type { Label, LabelledTodo } from "@/features/todos/types";

const TODAY = "2026-08-27";

const label = (over: Partial<Label> = {}): Label => ({
  id: 1,
  name: "要調査",
  color: "red",
  projectId: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

const todo = (over: Partial<LabelledTodo> = {}): LabelledTodo => ({
  id: 1,
  title: "task",
  status: "todo",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  projectId: 1,
  assigneeId: null,
  parentId: null,
  deletedAt: null,
  startAt: null,
  dueAt: null,
  description: null,
  priority: 0,
  labels: [],
  ...over,
});

describe("buildOverview", () => {
  it("counts progress from the rows it was given", () => {
    const overview = buildOverview(
      [todo({ id: 1, status: "done" }), todo({ id: 2 }), todo({ id: 3, status: "in_progress" })],
      [],
      [],
      TODAY,
    );

    expect(overview).toMatchObject({ total: 3, done: 1, percent: 33 });
  });

  it("reports zero for an empty project rather than dividing by it", () => {
    expect(buildOverview([], [], [], TODAY)).toMatchObject({ total: 0, done: 0, percent: 0 });
  });

  it("separates what is late from what is nearly due", () => {
    const overview = buildOverview(
      [
        todo({ id: 1, dueAt: "2026-08-20" }),
        todo({ id: 2, dueAt: TODAY }),
        todo({ id: 3, dueAt: "2026-12-01" }),
      ],
      [],
      [],
      TODAY,
    );

    expect(overview.overdue.map((t) => t.id)).toEqual([1]);
    expect(overview.dueSoon.map((t) => t.id)).toEqual([2]);
  });

  it("does not call a finished task late", () => {
    // Finished and late is history. Colouring it red fills a completed list
    // with alarm about work nobody has to do.
    const overview = buildOverview(
      [todo({ id: 1, dueAt: "2026-08-01", status: "done" })],
      [],
      [],
      TODAY,
    );

    expect(overview.overdue).toEqual([]);
  });

  it("counts unfinished work per person, and nobody as a person", () => {
    const overview = buildOverview(
      [
        todo({ id: 1, assigneeId: "u1" }),
        todo({ id: 2, assigneeId: "u1", status: "done" }),
        todo({ id: 3, assigneeId: null }),
      ],
      [],
      [{ id: "u1", name: "担当者" }],
      TODAY,
    );

    expect(overview.byAssignee).toEqual([
      { key: "u1", label: "担当者", count: 1 },
      { key: "__unassigned__", label: "未割り当て", count: 1 },
    ]);
  });

  it("leaves out labels nothing carries", () => {
    // A list of zeroes has to be read before it can be dismissed.
    const used = label({ id: 1, name: "使用中" });
    const unused = label({ id: 2, name: "未使用" });

    const overview = buildOverview([todo({ labels: [used] })], [used, unused], [], TODAY);

    expect(overview.byLabel.map((b) => b.label.name)).toEqual(["使用中"]);
  });

  it("counts undated unfinished work, which is the thing nobody schedules", () => {
    const overview = buildOverview(
      [todo({ id: 1 }), todo({ id: 2, dueAt: "2026-09-01" }), todo({ id: 3, status: "done" })],
      [],
      [],
      TODAY,
    );

    expect(overview.unscheduled).toBe(1);
  });
});
