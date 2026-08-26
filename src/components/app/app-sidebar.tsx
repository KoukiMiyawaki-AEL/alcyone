import { Link, useMatchRoute, useRouter, useRouterState } from "@tanstack/react-router";
import {
  CalendarRangeIcon,
  FolderIcon,
  KanbanIcon,
  ListIcon,
  PaletteIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import type { Project } from "@/features/projects/types";
import { apiClient } from "@/lib/api-client";

const globalItems = [
  { to: "/", label: "プロジェクト", icon: FolderIcon },
  { to: "/search", label: "検索", icon: SearchIcon },
  { to: "/dev/design-system", label: "Design System", icon: PaletteIcon },
] as const;

/**
 * The three arrangements of one project's tasks.
 *
 * They were buttons above the list, which put "which view" at the same level as
 * "which filter" — but a view is where you are, and a filter is how you have
 * narrowed it. Moving them here says so, and leaves the filters next to the
 * list they act on.
 */
const projectViews = [
  { view: "list", label: "一覧", icon: ListIcon },
  { view: "board", label: "ボード", icon: KanbanIcon },
  { view: "timeline", label: "タイムライン", icon: CalendarRangeIcon },
] as const;

const linkClass =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
const activeClass = "bg-accent text-accent-foreground";

/**
 * The caller's projects, for the switcher.
 *
 * A hook rather than a route loader because the sidebar is not a route — and
 * keyed on `useAuth()` rather than on the router context, which only re-solves
 * on navigation and so would leave the list empty on a hard reload until the
 * user clicked something.
 */
function useProjects(): Project[] {
  const { user } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiClient.api.projects.$get({ query: {} });
        if (!res.ok) return;
        const { items } = await res.json();
        if (!cancelled) setProjects(items as Project[]);
      } catch {
        // Navigation, not content. A failed refresh keeps the list that is
        // already on screen rather than blanking it.
      }
    };

    void load();
    // Every `router.invalidate()` ends in a resolve, so creating or deleting a
    // project updates this list from the page where it happened.
    const unsubscribe = router.subscribe("onResolved", () => void load());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user, router]);

  // Derived rather than cleared in the effect: signing out must not leave the
  // previous account's project names on screen, and writing state during an
  // effect to achieve that only schedules another render.
  return user ? projects : [];
}

export function AppSidebar() {
  const matchRoute = useMatchRoute();
  const { user } = useAuth();
  const projects = useProjects();

  // The project in view, if any. `fuzzy` so that the settings screen beneath it
  // still counts as being inside the project rather than as having left it.
  const inProject = matchRoute({ to: "/projects/$projectId", fuzzy: true });
  const projectId = inProject ? inProject.projectId : null;
  const onSettings = Boolean(matchRoute({ to: "/projects/$projectId/settings" }));
  // The view lives in the search params, which neither `matchRoute` nor
  // `activeProps` reports, so which one is current is decided here.
  const search = useRouterState({ select: (state) => state.location.search }) as {
    view?: string;
  };
  const currentView = projectId && !onSettings ? (search.view ?? "list") : null;

  return (
    <nav className="hidden w-56 shrink-0 border-r border-border p-3 sm:block">
      <ul className="flex flex-col gap-1">
        {globalItems.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className={linkClass}
              activeProps={{ className: activeClass }}
              // Without this, "/" matches every route beneath it and the
              // project list never stops looking selected.
              activeOptions={{ exact: item.to === "/" }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      {/*
        Only while a project is open. Showing these otherwise would be offering
        to change the view of nothing.
      */}
      {user?.role === "admin" ? (
        <ul className="flex flex-col gap-1">
          <li>
            <Link to="/admin" className={linkClass} activeProps={{ className: activeClass }}>
              <ShieldIcon className="size-4" />
              ユーザー管理
            </Link>
          </li>
        </ul>
      ) : null}

      {/*
        The switcher. The views below are premised on a project being open, so
        choosing which one has to be reachable from the same place rather than
        only from the list page.
      */}
      {user ? (
        <>
          <p className="mt-5 mb-1 px-3 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase">
            プロジェクト
          </p>
          {projects.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">まだありません</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: String(project.id) }}
                    // Not merged: the filters belong to the project being left,
                    // and carrying them into another one silently hides rows.
                    search={{}}
                    className={`${linkClass} ${
                      String(project.id) === projectId ? activeClass : ""
                    }`}
                    aria-current={String(project.id) === projectId ? "page" : undefined}
                  >
                    <span className="truncate">{project.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {projectId ? (
        <>
          <p className="mt-5 mb-1 px-3 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase">
            表示
          </p>
          <ul className="flex flex-col gap-1">
            {projectViews.map((item) => (
              <li key={item.view}>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId }}
                  // Merged rather than replaced: switching views must not throw
                  // away the filter and sort someone just set.
                  search={(prev) => ({ ...prev, view: item.view })}
                  className={`${linkClass} ${currentView === item.view ? activeClass : ""}`}
                  aria-current={currentView === item.view ? "page" : undefined}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/projects/$projectId/settings"
                params={{ projectId }}
                className={linkClass}
                activeProps={{ className: activeClass }}
              >
                <SettingsIcon className="size-4" />
                設定
              </Link>
            </li>
          </ul>
        </>
      ) : null}
    </nav>
  );
}
