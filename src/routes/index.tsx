import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { ArchiveIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { meets, viewerAccess } from "@/features/auth/access";
import { useAuth } from "@/features/auth/AuthProvider";
import { addProject, deleteProject, restoreProject, updateProject } from "@/features/projects/api";
import {
  ProjectFormDialog,
  type ProjectEditor,
} from "@/features/projects/components/ProjectFormDialog";
import { ProjectList } from "@/features/projects/components/ProjectList";
import type { Project, ProjectSummary } from "@/features/projects/types";
import { apiClient } from "@/lib/api-client";
import { toastUndo } from "@/lib/undo-toast";

const TRANSIENT = "プロジェクトの取得に失敗しました。";

/**
 * Which shelf is on screen. In the URL like every other list state: a link to
 * the archive is a link somebody can send.
 */
const searchSchema = z.object({
  archived: z.boolean().default(false).catch(false),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }): Promise<{ projects: ProjectSummary[]; error: string | null }> => {
    let res;
    try {
      res = await apiClient.api.dashboard.$get({ query: { archived: deps.archived ? "1" : "0" } });
    } catch {
      // Network failure only. Anything status-shaped is handled below, outside
      // the catch — `redirect()` works by throwing, so raising it in here would
      // be swallowed and rendered as the generic error card.
      return { projects: [], error: TRANSIENT };
    }

    if (res.status === 401) throw redirect({ to: "/login", search: { redirect: "/" } });
    if (!res.ok) return { projects: [], error: TRANSIENT };

    // Not paginated, unlike `GET /api/projects`: a dashboard that shows the
    // first page of projects and calls it an overview is worse than one that
    // shows all of them. The cost is a query proportional to how many projects
    // an account can reach, recorded in the readiness map (3-4).
    return { projects: (await res.json()).projects as ProjectSummary[], error: null };
  },
  pendingComponent: ProjectsPending,
  component: IndexComponent,
});

function ProjectsPending() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Projects" description="進行中のプロジェクトと、その進み具合" />
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
  const { archived } = Route.useSearch();
  // Creating a project is an operational act (ADR 0039). The server decides;
  // this only keeps the screen from offering what it would refuse.
  const canCreate = meets("admin", viewerAccess(useAuth()));
  const [editor, setEditor] = useState<ProjectEditor | null>(null);

  async function handleSave(values: Parameters<typeof addProject>[0], project: Project | null) {
    const saved = project
      ? // The key is not editable, so it is not sent. Passing it would be
        // asking the server to ignore a field, which is a worse contract than
        // not having one.
        await updateProject(project.id, {
          name: values.name,
          description: values.description,
          color: values.color,
          startAt: values.startAt,
          dueAt: values.dueAt,
        })
      : await addProject(values);

    if (saved) await router.invalidate();
    return saved;
  }

  async function handleArchive(id: number, archived: boolean) {
    if (await updateProject(id, { archived })) await router.invalidate();
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
      <PageHeader title="Projects" description="進行中のプロジェクトと、その進み具合" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {archived ? "アーカイブ済み" : "Projects"}
        </h2>
        <div className="flex items-center gap-2">
          {/*
            Archived projects are finished, not gone: they leave this list and
            stay one link away. The link is in the URL so it can be shared.
          */}
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/" search={{ archived: !archived }} />}
          >
            <ArchiveIcon className="size-4" />
            {archived ? "進行中を見る" : "アーカイブを見る"}
          </Button>
          {/*
            Hidden rather than disabled, and hidden rather than shown-and-
            refused. For an ordinary account this is not a thing they cannot do
            *yet* — it is a thing they never do, so a permanently dead control
            is furniture. And a button the API refuses is the shape ADR 0031
            set out to avoid.
          */}
          {archived || !canCreate ? null : (
            <Button size="sm" onClick={() => setEditor({ mode: "create" })}>
              <PlusIcon className="size-4" />
              プロジェクトを追加
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
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
          <ProjectList
            projects={projects}
            canCreate={canCreate}
            onDelete={handleDelete}
            onEdit={(project) => setEditor({ mode: "edit", project })}
            onArchive={handleArchive}
          />
        )}
      </div>
      <ProjectFormDialog
        editor={editor}
        onOpenChange={(open) => setEditor(open ? editor : null)}
        onSave={handleSave}
      />
    </div>
  );
}
