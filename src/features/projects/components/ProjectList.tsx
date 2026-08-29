import { FolderIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";

import type { ProjectSummary } from "../types";
import { ProjectCard } from "./ProjectCard";

type ProjectListProps = {
  projects: ProjectSummary[];
  /** Whether this account may create one — which decides what "none" means. */
  canCreate: boolean;
  onDelete: (id: number) => Promise<void>;
  onEdit: (project: ProjectSummary) => void;
  onArchive: (id: number, archived: boolean) => Promise<void>;
};

export function ProjectList({
  projects,
  canCreate,
  onDelete,
  onEdit,
  onArchive,
}: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={FolderIcon}
        title="No projects yet"
        // An empty screen should say what to do next. Pointing an ordinary
        // account at a button it does not have says what to do next for
        // somebody else.
        description={
          canCreate
            ? "「プロジェクトを追加」から最初のプロジェクトを作ってください。"
            : "参加しているプロジェクトはありません。管理者に追加してもらってください。"
        }
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
