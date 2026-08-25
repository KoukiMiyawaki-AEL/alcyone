import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TodoBoard } from "@/features/todos/components/TodoBoard";
import type { Todo } from "@/features/todos/types";

const todo = (over: Partial<Todo> = {}): Todo => ({
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
  ...over,
});

function renderBoard(props: Partial<Parameters<typeof TodoBoard>[0]> = {}) {
  return render(
    <TodoBoard
      todos={[todo()]}
      assignees={[]}
      today="2026-08-26"
      onStatusChange={vi.fn()}
      onEdit={vi.fn()}
      truncated={false}
      {...props}
    />,
  );
}

/** Column contents are asserted through the labelled region, not by position. */
const column = (name: string) => within(screen.getByRole("region", { name }));

describe("TodoBoard", () => {
  it("puts each task in the column its status names", () => {
    renderBoard({
      todos: [
        todo({ id: 1, title: "未着手のもの", status: "todo" }),
        todo({ id: 2, title: "進行中のもの", status: "in_progress" }),
        todo({ id: 3, title: "詰まっているもの", status: "blocked" }),
        todo({ id: 4, title: "終わったもの", status: "done" }),
      ],
    });

    expect(column("未着手").getByText("未着手のもの")).toBeInTheDocument();
    expect(column("進行中").getByText("進行中のもの")).toBeInTheDocument();
    expect(column("ブロック中").getByText("詰まっているもの")).toBeInTheDocument();
    expect(column("完了").getByText("終わったもの")).toBeInTheDocument();
  });

  it("counts what is in each column", () => {
    renderBoard({
      todos: [
        todo({ id: 1, status: "todo" }),
        todo({ id: 2, title: "b", status: "todo" }),
        todo({ id: 3, title: "c", status: "done" }),
      ],
    });

    expect(column("未着手").getByText("2")).toBeInTheDocument();
    expect(column("完了").getByText("1")).toBeInTheDocument();
  });

  it("moves a task with the keyboard, not only by dragging", async () => {
    // HTML5 drag and drop cannot be reached from a keyboard at all, so the
    // board would be unusable without this. It is the path being tested
    // because it is the one that has to work for everyone.
    const user = userEvent.setup();
    const onStatusChange = vi.fn().mockResolvedValue(undefined);
    renderBoard({ todos: [todo({ title: "動かす" })], onStatusChange });

    await user.click(screen.getByRole("button", { name: "「動かす」を進行中へ移動" }));

    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith(1, "in_progress");
  });

  it("offers every column except the one the task is already in", () => {
    renderBoard({ todos: [todo({ title: "止まっている", status: "blocked" })] });

    expect(
      screen.getByRole("button", { name: "「止まっている」を未着手へ移動" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "「止まっている」を完了へ移動" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "「止まっている」をブロック中へ移動" }),
    ).not.toBeInTheDocument();
  });

  it("moves a task when it is dropped on another column", () => {
    const onStatusChange = vi.fn().mockResolvedValue(undefined);
    renderBoard({ todos: [todo({ title: "運ぶ", status: "todo" })], onStatusChange });

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "move",
    };

    fireEvent.dragStart(screen.getByRole("button", { name: "運ぶ" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("region", { name: "完了" }), { dataTransfer });

    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith(1, "done");
  });

  it("does not write when a task is dropped back where it started", () => {
    // A drop that changes nothing is not a write. Sending one would churn
    // `updatedAt` and tell every other tab to refetch for no reason.
    const onStatusChange = vi.fn().mockResolvedValue(undefined);
    renderBoard({ todos: [todo({ title: "戻す", status: "todo" })], onStatusChange });

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "move",
    };

    fireEvent.dragStart(screen.getByRole("button", { name: "戻す" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("region", { name: "未着手" }), { dataTransfer });

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("opens the detail form from a card", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderBoard({ todos: [todo({ id: 7, title: "開く" })], onEdit });

    await user.click(screen.getByRole("button", { name: "開く" }));

    expect(onEdit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 7 }));
  });

  it("counts what is late in each column", () => {
    // A board exists to answer "where is the work", and "some of it is late"
    // is part of that answer.
    renderBoard({
      todos: [
        todo({ id: 1, title: "遅れ", status: "todo", dueAt: "2026-08-20" }),
        todo({ id: 2, title: "まだ", status: "todo", dueAt: "2026-12-20" }),
      ],
      today: "2026-08-26",
    });

    expect(column("未着手").getByText("1 期限切れ")).toBeInTheDocument();
    expect(column("進行中").queryByText(/期限切れ/)).not.toBeInTheDocument();
  });

  it("says so when it is not showing everything", () => {
    // A board that silently omits tasks is worse than one that admits it:
    // the whole point is seeing where the work is.
    renderBoard({ truncated: true });

    expect(screen.getByText(/最初の1件です/)).toBeInTheDocument();
  });

  it("stays quiet when it is showing everything", () => {
    renderBoard({ truncated: false });

    expect(screen.queryByText(/最初の/)).not.toBeInTheDocument();
  });
});
