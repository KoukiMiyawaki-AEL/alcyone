import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectForm } from "@/features/projects/components/ProjectForm";

describe("ProjectForm", () => {
  it("disables submit until a non-blank name is typed", async () => {
    const user = userEvent.setup();
    render(<ProjectForm onAdd={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "Add Project" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("New project name"), "   ");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("New project name"), "Alcyone");
    expect(submit).toBeEnabled();
  });

  it("trims the name and clears the field on success", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<ProjectForm onAdd={onAdd} />);

    const input = screen.getByLabelText("New project name");
    await user.type(input, "  Alcyone  ");
    await user.click(screen.getByRole("button", { name: "Add Project" }));

    expect(onAdd).toHaveBeenCalledExactlyOnceWith("Alcyone");
    expect(input).toHaveValue("");
  });

  it("keeps the typed name when the add fails", async () => {
    const user = userEvent.setup();
    render(<ProjectForm onAdd={vi.fn().mockResolvedValue(false)} />);

    const input = screen.getByLabelText("New project name");
    await user.type(input, "Alcyone");
    await user.click(screen.getByRole("button", { name: "Add Project" }));

    expect(input).toHaveValue("Alcyone");
    expect(input).toBeEnabled();
  });
});
