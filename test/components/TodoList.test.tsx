import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TodoList } from "@/features/todos/components/TodoList";
import type { LabelledTodo } from "@/features/todos/types";

const todo = (over: Partial<LabelledTodo> = {}): LabelledTodo => ({
  id: 1,
  title: "Write tests",
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
  labels: [],
  ...over,
});

function renderList(props: Partial<Parameters<typeof TodoList>[0]> = {}) {
  return render(
    <TodoList
      todos={[todo()]}
      assignees={[]}
      today="2026-08-26"
      onStatusChange={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />,
  );
}

describe("TodoList", () => {
  it("renders an empty state instead of an empty box", () => {
    renderList({ todos: [] });

    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders one row per todo", () => {
    renderList({ todos: [todo(), todo({ id: 2, title: "Ship it" })] });

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
  });

  it("puts a child directly under its parent", () => {
    // Order in the data is creation order; order on screen is the hierarchy.
    renderList({
      todos: [
        todo({ id: 1, title: "親A" }),
        todo({ id: 2, title: "親B" }),
        todo({ id: 3, title: "Aの子", parentId: 1 }),
      ],
    });

    const titles = screen
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("aria-label") ?? "");
    expect(titles[0]).toContain("親A");
    expect(titles[1]).toContain("Aの子");
    expect(titles[2]).toContain("親B");
  });

  it("keeps a child whose parent is not in view at the top level", () => {
    // Filtered out, or on a later page. Hiding the child because of where its
    // parent is would make the list lie about the project.
    renderList({ todos: [todo({ id: 3, title: "親のいない子", parentId: 99 })] });

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("親のいない子")).toBeInTheDocument();
  });

  it("shows each task once, even with a parent and children mixed together", () => {
    renderList({
      todos: [
        todo({ id: 1, title: "親" }),
        todo({ id: 2, title: "子1", parentId: 1 }),
        todo({ id: 3, title: "子2", parentId: 1 }),
      ],
    });

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("moves a todo to done, and back to todo, from the checkbox", async () => {
    // The checkbox writes the same `status` field the dialog does. Unchecking
    // returns the task to "todo" — the row does not know what it was before,
    // and guessing would be worse than the plain inverse.
    const user = userEvent.setup();
    const onStatusChange = vi.fn().mockResolvedValue(undefined);
    renderList({
      todos: [todo(), todo({ id: 2, title: "Ship it", status: "done" })],
      onStatusChange,
    });

    await user.click(screen.getByRole("checkbox", { name: "「Write tests」を完了にする" }));
    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith(1, "done");

    onStatusChange.mockClear();
    await user.click(screen.getByRole("checkbox", { name: "「Ship it」を未完了に戻す" }));
    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith(2, "todo");
  });

  it("shows a badge for a state the checkbox cannot express", () => {
    // "todo" and "done" are already visible from the checkbox, so badging them
    // would bury the two states that actually need attention.
    renderList({
      todos: [
        todo({ id: 1, title: "Plain", status: "todo" }),
        todo({ id: 2, title: "Running", status: "in_progress" }),
        todo({ id: 3, title: "Stuck", status: "blocked" }),
      ],
    });

    expect(screen.getByText("進行中")).toBeInTheDocument();
    expect(screen.getByText("ブロック中")).toBeInTheDocument();
    expect(screen.queryByText("未着手")).not.toBeInTheDocument();
  });

  it("marks a task whose due date has passed", () => {
    // The single most actionable fact in a list, and it used to render exactly
    // like a date next month — leaving the reader to compare every row against
    // today themselves, which is not what anyone does with a list.
    renderList({
      todos: [
        todo({ id: 1, title: "遅れている", dueAt: "2026-08-20" }),
        todo({ id: 2, title: "まだ先", dueAt: "2026-12-20" }),
      ],
      today: "2026-08-26",
    });

    expect(screen.getByLabelText("期限切れ 2026-08-20")).toBeInTheDocument();
    expect(screen.getByLabelText("期限 2026-12-20")).toBeInTheDocument();
  });

  it("stops marking it once the task is done", () => {
    // A finished task that was late is history; alarming about it fills a
    // completed list with work nobody has to do.
    renderList({
      todos: [todo({ title: "終わった", dueAt: "2026-08-20", status: "done" })],
      today: "2026-08-26",
    });

    expect(screen.getByLabelText("期限 2026-08-20")).toBeInTheDocument();
  });

  it("names today's deadline as today's", () => {
    renderList({ todos: [todo({ dueAt: "2026-08-26" })], today: "2026-08-26" });

    expect(screen.getByLabelText("本日期限 2026-08-26")).toBeInTheDocument();
  });

  it("shows the dates and the note a todo carries", () => {
    renderList({
      todos: [
        todo({
          startAt: "2026-09-01",
          dueAt: "2026-09-30",
          description: "先に設計を書く",
          priority: 2,
        }),
      ],
    });

    expect(screen.getByLabelText("開始日 2026-09-01")).toBeInTheDocument();
    expect(screen.getByLabelText(/2026-09-30/)).toBeInTheDocument();
    expect(screen.getByText("先に設計を書く")).toBeInTheDocument();
    expect(screen.getByLabelText("優先度: Medium")).toBeInTheDocument();
  });

  it("opens the detail editor for the row it was asked about", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderList({ todos: [todo(), todo({ id: 2, title: "Ship it" })], onEdit });

    await user.click(screen.getByRole("button", { name: "「Ship it」の操作" }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "詳細を編集" }));

    expect(onEdit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 2 }));
  });

  it("deletes the right todo from its row menu", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderList({ todos: [todo(), todo({ id: 2, title: "Ship it" })], onDelete });

    await user.click(screen.getByRole("button", { name: "「Ship it」の操作" }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "削除" }));

    expect(onDelete).toHaveBeenCalledExactlyOnceWith(2);
  });
});

describe("labels on a row", () => {
  it("shows each label the task carries", async () => {
    renderList({
      todos: [
        todo({
          labels: [
            { id: 7, name: "要調査", color: "red", projectId: 1, createdAt: "2026-08-24" },
            { id: 8, name: "リリース待ち", color: "blue", projectId: 1, createdAt: "2026-08-24" },
          ],
        }),
      ],
    });

    expect(await screen.findByText("要調査")).toBeInTheDocument();
    expect(screen.getByText("リリース待ち")).toBeInTheDocument();
  });

  it("shows nothing at all when a task has none", async () => {
    // An empty row of chips is a gap the eye stops at for no reason.
    const { container } = renderList({ todos: [todo({ title: "裸のタスク" })] });

    await screen.findByText("裸のタスク");
    expect(container.querySelectorAll("[class*='rounded-full'][class*='border']")).toHaveLength(0);
  });
});
