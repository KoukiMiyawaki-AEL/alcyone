import { RouterProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectList } from "@/features/projects/components/ProjectList";
import type { ProjectSummary } from "@/features/projects/types";

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 1,
  name: "Alcyone",
  createdAt: "2026-08-24T00:00:00.000Z",
  ownerId: "user_1",
  deletedAt: null,
  key: "ALC",
  description: null,
  color: "slate",
  startAt: null,
  dueAt: null,
  archivedAt: null,
  total: 0,
  done: 0,
  overdue: 0,
  dueToday: 0,
  ...over,
});

/**
 * ProjectCard renders a `<Link>`, which needs a router in context. A memory
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
    renderInRouter(
      <ProjectList
        projects={[]}
        canCreate
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders one linked card per project", async () => {
    renderInRouter(
      <ProjectList
        projects={[project(), project({ id: 2, name: "Second" })]}
        canCreate
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(await screen.findByRole("link", { name: /Alcyone/ })).toHaveAttribute(
      "href",
      "/projects/1",
    );
    expect(screen.getByRole("link", { name: /Second/ })).toHaveAttribute("href", "/projects/2");
  });

  it("deletes the right project from its own menu", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderInRouter(
      <ProjectList
        projects={[project(), project({ id: 2, name: "Second" })]}
        canCreate
        onDelete={onDelete}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: 'Actions for "Second"' }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledExactlyOnceWith(2);
  });
});

describe("ProjectCard progress", () => {
  it("reports how much of the project is done", async () => {
    renderInRouter(
      <ProjectList
        projects={[project({ total: 4, done: 3 })]}
        canCreate
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(await screen.findByText("3 / 4 完了（75%）")).toBeInTheDocument();
  });

  it("says a project has no tasks rather than showing it as 0% done", async () => {
    // A bar pinned at zero reads as failure. An empty project has not failed
    // at anything, it has not started.
    renderInRouter(
      <ProjectList
        projects={[project()]}
        canCreate
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(await screen.findByText("まだタスクがありません")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows overdue and due-today counts only when there are any", async () => {
    renderInRouter(
      <ProjectList
        projects={[project({ total: 5, done: 1, overdue: 2, dueToday: 0 })]}
        canCreate
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(await screen.findByText("期限切れ 2")).toBeInTheDocument();
    // A row of zeroes is noise that has to be read before it can be dismissed.
    expect(screen.queryByText(/本日期限/)).not.toBeInTheDocument();
  });
});

describe("what an empty list says", () => {
  it("points somebody who can create at the way to create", async () => {
    renderInRouter(
      <ProjectList
        projects={[]}
        canCreate
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(await screen.findByText(/「プロジェクトを追加」から/)).toBeInTheDocument();
  });

  it("tells somebody who cannot what to do instead", async () => {
    // An empty screen should say what to do next. Pointing an ordinary account
    // at a button it does not have says what to do next for somebody else.
    renderInRouter(
      <ProjectList
        projects={[]}
        canCreate={false}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(await screen.findByText(/管理者に追加してもらって/)).toBeInTheDocument();
    expect(screen.queryByText(/「プロジェクトを追加」から/)).not.toBeInTheDocument();
  });
});
