import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TodoList } from "@/features/todos/components/TodoList";
import type { Todo } from "@/features/todos/types";

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: "Write tests",
  completed: false,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  projectId: 1,
  deletedAt: null,
  dueAt: null,
  priority: 0,
  ...over,
});

describe("TodoList", () => {
  it("renders an empty state instead of an empty box", () => {
    render(<TodoList todos={[]} onToggle={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders one row per todo", () => {
    render(
      <TodoList
        todos={[todo(), todo({ id: 2, title: "Ship it" })]}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
  });

  it("reports the new completed state when a row is toggled", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(
      <TodoList
        todos={[todo(), todo({ id: 2, title: "Ship it", completed: true })]}
        onToggle={onToggle}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: 'Mark "Write tests" as done' }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(1, true);

    onToggle.mockClear();
    await user.click(screen.getByRole("checkbox", { name: 'Mark "Ship it" as not done' }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(2, false);
  });

  it("deletes the right todo from its row menu", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <TodoList
        todos={[todo(), todo({ id: 2, title: "Ship it" })]}
        onToggle={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: 'Actions for "Ship it"' }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledExactlyOnceWith(2);
  });
});
