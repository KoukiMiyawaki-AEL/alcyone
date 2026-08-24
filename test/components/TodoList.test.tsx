import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TodoList } from "@/features/todos/components/TodoList";
import type { Todo } from "@/features/todos/types";

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: "Write tests",
  completed: false,
  status: "todo",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  projectId: 1,
  deletedAt: null,
  startAt: null,
  dueAt: null,
  description: null,
  priority: 0,
  ...over,
});

function renderList(props: Partial<Parameters<typeof TodoList>[0]> = {}) {
  return render(
    <TodoList
      todos={[todo()]}
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

  it("moves a todo to done, and back to todo, from the checkbox", async () => {
    // The checkbox writes the same `status` field the dialog does. Unchecking
    // returns the task to "todo" — the row does not know what it was before,
    // and guessing would be worse than the plain inverse.
    const user = userEvent.setup();
    const onStatusChange = vi.fn().mockResolvedValue(undefined);
    renderList({
      todos: [todo(), todo({ id: 2, title: "Ship it", status: "done", completed: true })],
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
    expect(screen.getByLabelText("期限日 2026-09-30")).toBeInTheDocument();
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
