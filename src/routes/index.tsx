import { createFileRoute, useRouter } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { addProject, deleteProject } from "@/features/projects/api";
import { ProjectForm } from "@/features/projects/components/ProjectForm";
import { ProjectList } from "@/features/projects/components/ProjectList";
import type { Project } from "@/features/projects/types";
import { apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/")({
  loader: async (): Promise<{ projects: Project[]; error: string | null }> => {
    try {
      const res = await apiClient.api.projects.$get();
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      return { projects: await res.json(), error: null };
    } catch {
      return { projects: [], error: "プロジェクトの取得に失敗しました。" };
    }
  },
  pendingComponent: ProjectsPending,
  component: IndexComponent,
});

function ProjectsPending() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Projects" description="Group your tasks by project" />
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    </div>
  );
}

function IndexComponent() {
  const router = useRouter();
  const { projects, error } = Route.useLoaderData();

  async function handleAdd(name: string) {
    const added = await addProject(name);
    if (added) await router.invalidate();
    return added;
  }

  async function handleDelete(id: number) {
    if (await deleteProject(id)) await router.invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Projects" description="Group your tasks by project" />

      <Card>
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm onAdd={handleAdd} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Projects</h2>
        {error ? (
          <EmptyState
            icon={TriangleAlertIcon}
            title="Something went wrong"
            description={error}
            action={
              <Button size="sm" variant="outline" onClick={() => router.invalidate()}>
                Retry
              </Button>
            }
          />
        ) : (
          <ProjectList projects={projects} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}
