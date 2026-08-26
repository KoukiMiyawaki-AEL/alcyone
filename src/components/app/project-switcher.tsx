import { Link, useMatchRoute, useRouter } from "@tanstack/react-router";
import { CheckIcon, ChevronsUpDownIcon, FolderIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/AuthProvider";
import { useProjects } from "@/features/projects/use-projects";

/**
 * Which project everything else is about.
 *
 * In the header rather than the sidebar because it is not one of the things a
 * project offers — it decides which project is offering them. The sidebar
 * below is scoped to whatever this says.
 */
export function ProjectSwitcher() {
  const { user } = useAuth();
  const router = useRouter();
  const matchRoute = useMatchRoute();
  const projects = useProjects();

  if (!user) return null;

  const open = matchRoute({ to: "/projects/$projectId", fuzzy: true });
  const currentId = open ? open.projectId : null;
  const current = projects.find((project) => String(project.id) === currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="max-w-[16rem] gap-2"
            aria-label="プロジェクトを切り替える"
          >
            <FolderIcon className="size-4 shrink-0" />
            <span className="truncate">
              {/*
                A project that is open but not in the list is one this account
                cannot see the name of — it says so rather than showing a blank
                button whose meaning has to be guessed.
              */}
              {current?.name ?? (currentId ? "プロジェクト" : "プロジェクトを選ぶ")}
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        {projects.length === 0 ? (
          <DropdownMenuItem disabled>まだプロジェクトがありません</DropdownMenuItem>
        ) : (
          projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              // Search params are not carried across: the filter belongs to the
              // project being left, and taking it along hides rows in the one
              // being entered without saying so.
              onClick={() =>
                void router.navigate({
                  to: "/projects/$projectId",
                  params: { projectId: String(project.id) },
                  search: {},
                })
              }
            >
              <CheckIcon
                className={`size-4 ${String(project.id) === currentId ? "" : "opacity-0"}`}
              />
              <span className="truncate">{project.name}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/" />}>
          <PlusIcon className="size-4" />
          すべてのプロジェクト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
