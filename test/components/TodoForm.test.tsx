import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TodoForm } from "@/features/todos/components/TodoForm";

describe("TodoForm", () => {
  it("disables submit until a non-blank title is typed", async () => {
    const user = userEvent.setup();
    render(<TodoForm onAdd={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "Add Todo" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("New task title"), "   ");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("New task title"), "Write tests");
    expect(submit).toBeEnabled();
  });

  it("trims the title and clears the field on success", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<TodoForm onAdd={onAdd} />);

    const input = screen.getByLabelText("New task title");
    await user.type(input, "  Write tests  ");
    await user.click(screen.getByRole("button", { name: "Add Todo" }));

    expect(onAdd).toHaveBeenCalledExactlyOnceWith("Write tests");
    expect(input).toHaveValue("");
  });

  it("keeps the typed title when the add fails", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(false);
    render(<TodoForm onAdd={onAdd} />);

    const input = screen.getByLabelText("New task title");
    await user.type(input, "Write tests");
    await user.click(screen.getByRole("button", { name: "Add Todo" }));

    // What the user typed must survive a failed request so they can retry
    // without retyping it.
    expect(input).toHaveValue("Write tests");
    expect(input).toBeEnabled();
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
    render(<TodoForm onAdd={onAdd} />);

    await user.type(screen.getByLabelText("New task title"), "Write tests");
    const submit = screen.getByRole("button", { name: "Add Todo" });
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("New task title")).toBeDisabled();

    release();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
