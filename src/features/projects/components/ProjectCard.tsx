import { Link } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarClockIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { LabelSwatch } from "@/features/todos/components/LabelChip";

import type { ProjectSummary } from "../types";

type ProjectCardProps = {
  project: ProjectSummary;
  onDelete: (id: number) => Promise<void>;
  onEdit: (project: ProjectSummary) => void;
  onArchive: (id: number, archived: boolean) => Promise<void>;
};

export function ProjectCard({ project, onDelete, onEdit, onArchive }: ProjectCardProps) {
  const { total, done, overdue, dueToday } = project;
  const archived = project.archivedAt !== null;
  // An empty project is not 0% finished, it is not started — and showing a bar
  // stuck at zero reads as failure rather than as an empty page.
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-2">
          {/* The colour, so the card is recognisable before it is read. */}
          <LabelSwatch color={project.color} />
          <Link
            to="/projects/$projectId"
            params={{ projectId: String(project.id) }}
            search={{}}
            className="min-w-0 flex-1 text-sm font-medium hover:underline"
          >
            {project.name}
          </Link>
          <Badge variant="outline" className="shrink-0 font-mono text-[0.7rem]">
            {project.key}
          </Badge>
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
              <DropdownMenuItem onClick={() => onEdit(project)}>
                <PencilIcon />
                設定を編集
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onArchive(project.id, !archived)}>
                {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                {archived ? "アーカイブから戻す" : "アーカイブする"}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(project.id)}>
                <TrashIcon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {project.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
        ) : null}

        {project.startAt || project.dueAt ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {project.startAt ?? "—"} 〜 {project.dueAt ?? "—"}
          </p>
        ) : null}

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
