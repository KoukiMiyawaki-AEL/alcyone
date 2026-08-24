import { FolderIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Separator } from "@/components/ui/separator";

import type { Project } from "../types";
import { ProjectRow } from "./ProjectRow";

type ProjectListProps = {
  projects: Project[];
  onDelete: (id: number) => Promise<void>;
};

export function ProjectList({ projects, onDelete }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={FolderIcon}
        title="No projects yet"
        description="上のフォームから最初のプロジェクトを追加してください。"
      />
    );
  }

  return (
    <div className="rounded-lg border border-border">
      {projects.map((project, index) => (
        <div key={project.id}>
          {index > 0 ? <Separator /> : null}
          <ProjectRow project={project} onDelete={onDelete} />
        </div>
      ))}
    </div>
  );
}
