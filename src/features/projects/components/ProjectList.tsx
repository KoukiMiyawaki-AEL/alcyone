import { FolderIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";

import type { ProjectSummary } from "../types";
import { ProjectCard } from "./ProjectCard";

type ProjectListProps = {
  projects: ProjectSummary[];
  onDelete: (id: number) => Promise<void>;
  onEdit: (project: ProjectSummary) => void;
  onArchive: (id: number, archived: boolean) => Promise<void>;
};

export function ProjectList({ projects, onDelete, onEdit, onArchive }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={FolderIcon}
        title="No projects yet"
        description="「プロジェクトを追加」から最初のプロジェクトを作ってください。"
      />
    );
  }

  // A grid rather than rows: each project now carries its own progress and
  // counts, and stacking those full width makes a short list look like a long
  // one.
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onDelete={onDelete}
          onEdit={onEdit}
          onArchive={onArchive}
        />
      ))}
    </div>
  );
}
