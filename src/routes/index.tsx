import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { addProject, deleteProject, restoreProject } from "@/features/projects/api";
import { ProjectForm } from "@/features/projects/components/ProjectForm";
import { ProjectList } from "@/features/projects/components/ProjectList";
import type { Project } from "@/features/projects/types";
import { apiClient } from "@/lib/api-client";
import { toastUndo } from "@/lib/undo-toast";

const TRANSIENT = "プロジェクトの取得に失敗しました。";

export const Route = createFileRoute("/")({
  // The guard lives here rather than on the root route so that /login itself
  // stays reachable. `isPending` must not count as signed-out, or a hard reload
  // would bounce a signed-in user to the login screen before the session
  // request has even come back.
  beforeLoad: ({ context, location }) => {
    if (context.auth.isPending) return;
    if (!context.auth.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  loader: async (): Promise<{ projects: Project[]; error: string | null }> => {
    let res;
    try {
      res = await apiClient.api.projects.$get({ query: {} });
    } catch {
      // Network failure only. Anything status-shaped is handled below, outside
      // the catch — `redirect()` works by throwing, so raising it in here would
      // be swallowed and rendered as the generic error card.
      return { projects: [], error: TRANSIENT };
    }

    if (res.status === 401) throw redirect({ to: "/login", search: { redirect: "/" } });
    if (!res.ok) return { projects: [], error: TRANSIENT };

    // Only the first page is shown. There is no "load more" yet, so a user
    // with more projects than the default page size would not see them all —
    // recorded rather than hidden. See the readiness map, 3-4.
    return { projects: (await res.json()).items, error: null };
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
    if (!(await deleteProject(id))) return;
    await router.invalidate();

    toastUndo("プロジェクトを削除しました。", async () => {
      if (await restoreProject(id)) await router.invalidate();
    });
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
