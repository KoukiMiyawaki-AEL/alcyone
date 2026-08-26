import { Link, useMatchRoute, useRouterState } from "@tanstack/react-router";
import {
  CalendarRangeIcon,
  FolderIcon,
  KanbanIcon,
  ListIcon,
  PaletteIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";

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

export function AppSidebar() {
  const matchRoute = useMatchRoute();

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
