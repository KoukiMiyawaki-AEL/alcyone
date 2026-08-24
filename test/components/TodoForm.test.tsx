import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TodoForm } from "@/features/todos/components/TodoForm";

describe("TodoForm", () => {
  it("disables submit until a non-blank title is typed", async () => {
    const user = userEvent.setup();
    render(<TodoForm onAdd={vi.fn()} onAddWithDetails={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "追加" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("新しいタスクのタイトル"), "   ");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("新しいタスクのタイトル"), "Write tests");
    expect(submit).toBeEnabled();
  });

  it("trims the title and clears the field on success", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<TodoForm onAdd={onAdd} onAddWithDetails={vi.fn()} />);

    const input = screen.getByLabelText("新しいタスクのタイトル");
    await user.type(input, "  Write tests  ");
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(onAdd).toHaveBeenCalledExactlyOnceWith("Write tests");
    expect(input).toHaveValue("");
  });

  it("keeps the typed title when the add fails", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(false);
    render(<TodoForm onAdd={onAdd} onAddWithDetails={vi.fn()} />);

    const input = screen.getByLabelText("新しいタスクのタイトル");
    await user.type(input, "Write tests");
    await user.click(screen.getByRole("button", { name: "追加" }));

    // What the user typed must survive a failed request so they can retry
    // without retyping it.
    expect(input).toHaveValue("Write tests");
    expect(input).toBeEnabled();
  });

  it("hands the typed title to the detail form and clears the box", async () => {
    // Reaching for the details must not cost the words already written —
    // retyping them is exactly the friction that stops anyone from bothering.
    const user = userEvent.setup();
    const onAddWithDetails = vi.fn();
    render(<TodoForm onAdd={vi.fn()} onAddWithDetails={onAddWithDetails} />);

    const input = screen.getByLabelText("新しいタスクのタイトル");
    await user.type(input, "  設計を書く  ");
    await user.click(screen.getByRole("button", { name: "詳細を設定して追加" }));

    expect(onAddWithDetails).toHaveBeenCalledExactlyOnceWith("設計を書く");
    expect(input).toHaveValue("");
  });

  it("offers the detail form even with nothing typed", async () => {
    // Starting from the full form is a reasonable way to begin, and the form
    // requires a title of its own.
    const user = userEvent.setup();
    const onAddWithDetails = vi.fn();
    render(<TodoForm onAdd={vi.fn()} onAddWithDetails={onAddWithDetails} />);

    await user.click(screen.getByRole("button", { name: "詳細を設定して追加" }));

    expect(onAddWithDetails).toHaveBeenCalledExactlyOnceWith("");
  });

  it("does not submit twice while a request is in flight", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const onAdd = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    render(<TodoForm onAdd={onAdd} onAddWithDetails={vi.fn()} />);

    await user.type(screen.getByLabelText("新しいタスクのタイトル"), "Write tests");
    const submit = screen.getByRole("button", { name: "追加" });
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("新しいタスクのタイトル")).toBeDisabled();

    release();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
