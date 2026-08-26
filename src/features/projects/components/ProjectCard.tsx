import { Link } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";

import type { ProjectSummary } from "../types";

type ProjectCardProps = {
  project: ProjectSummary;
  onDelete: (id: number) => Promise<void>;
};

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const { total, done, overdue, dueToday } = project;
  // An empty project is not 0% finished, it is not started — and showing a bar
  // stuck at zero reads as failure rather than as an empty page.
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <Link
            to="/projects/$projectId"
            params={{ projectId: String(project.id) }}
            search={{}}
            className="min-w-0 flex-1 text-sm font-medium hover:underline"
          >
            {project.name}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-mt-1 shrink-0"
                  aria-label={`Actions for "${project.name}"`}
                >
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

        {total === 0 ? (
          <p className="text-xs text-muted-foreground">まだタスクがありません</p>
        ) : (
          <>
            <Progress value={percent} aria-label={`${project.name} の進捗`} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {done} / {total} 完了（{percent}%）
              </span>
              {/*
                Only shown when there is something to say. A row of zeroes is
                noise that has to be read before it can be dismissed.
              */}
              {overdue > 0 ? (
                <span className="flex items-center gap-1 font-medium text-destructive">
                  <AlertTriangleIcon className="size-3.5" />
                  期限切れ {overdue}
                </span>
              ) : null}
              {dueToday > 0 ? (
                <span className="flex items-center gap-1 font-medium text-primary">
                  <CalendarClockIcon className="size-3.5" />
                  本日期限 {dueToday}
                </span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
