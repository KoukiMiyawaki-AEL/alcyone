import { RouterProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectList } from "@/features/projects/components/ProjectList";
import type { Project } from "@/features/projects/types";

const project = (over: Partial<Project> = {}): Project => ({
  id: 1,
  name: "Alcyone",
  createdAt: "2026-08-24T00:00:00.000Z",
  ...over,
});

/**
 * ProjectRow renders a `<Link>`, which needs a router in context. A memory
 * router around the component under test keeps this a component test — no
 * route files, no loaders, no fetch.
 */
function renderInRouter(ui: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({ routeTree: rootRoute });
  return render(<RouterProvider router={router} />);
}

describe("ProjectList", () => {
  it("renders an empty state instead of an empty box", async () => {
    renderInRouter(<ProjectList projects={[]} onDelete={vi.fn()} />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders one linked row per project", async () => {
    renderInRouter(
      <ProjectList projects={[project(), project({ id: 2, name: "Second" })]} onDelete={vi.fn()} />,
    );

    expect(await screen.findByRole("link", { name: /Alcyone/ })).toHaveAttribute(
      "href",
      "/projects/1",
    );
    expect(screen.getByRole("link", { name: /Second/ })).toHaveAttribute("href", "/projects/2");
  });

  it("deletes the right project from its row menu", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderInRouter(
      <ProjectList
        projects={[project(), project({ id: 2, name: "Second" })]}
        onDelete={onDelete}
      />,
    );

    await user.click(await screen.findByRole("button", { name: 'Actions for "Second"' }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledExactlyOnceWith(2);
  });
});
