import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, EllipsisVerticalIcon, TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { Project } from "../types";

type ProjectRowProps = {
  project: Project;
  onDelete: (id: number) => Promise<void>;
};

export function ProjectRow({ project, onDelete }: ProjectRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link
        to="/projects/$projectId"
        params={{ projectId: String(project.id) }}
        className="flex flex-1 items-center gap-2 text-sm font-medium hover:underline"
      >
        {project.name}
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for "${project.name}"`}>
              <EllipsisVerticalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(project.id)}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
