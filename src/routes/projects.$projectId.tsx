import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { FolderXIcon, TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Project } from "@/features/projects/types";
import { addTodo, deleteTodo, setTodoCompleted } from "@/features/todos/api";
import { TodoForm } from "@/features/todos/components/TodoForm";
import { TodoList } from "@/features/todos/components/TodoList";
import type { Todo } from "@/features/todos/types";
import { apiClient } from "@/lib/api-client";

type LoaderData = { project: Project | null; todos: Todo[]; error: string | null };

export const Route = createFileRoute("/projects/$projectId")({
  loader: async ({ params }): Promise<LoaderData> => {
    let res;
    try {
      res = await apiClient.api.projects[":projectId"].todos.$get({
        param: { projectId: params.projectId },
      });
    } catch {
      // Network failure is transient — show the inline Retry card, not a
      // hard "not found". The project may well exist.
      return { project: null, todos: [], error: TRANSIENT };
    }

    // Thrown outside the catch on purpose. `notFound()` works by throwing, so
    // raising it inside the try above would be swallowed and turned into the
    // generic error card.
    // 400 is included because a non-numeric :projectId fails param validation,
    // which for the user is the same thing as the project not existing.
    if (res.status === 404 || res.status === 400) throw notFound();

    if (!res.ok) return { project: null, todos: [], error: TRANSIENT };

    const { project, todos } = await res.json();
    return { project, todos, error: null };
  },
  pendingComponent: TodosPending,
  component: ProjectTodosComponent,
  notFoundComponent: ProjectNotFound,
});

const TRANSIENT = "タスクの取得に失敗しました。";

function TodosPending() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Todos" description="Manage your tasks" />
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
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

function ProjectNotFound() {
  return (
    <EmptyState
      icon={FolderXIcon}
      title="Project not found"
      description="お探しのプロジェクトは存在しません。"
      action={
        <Button size="sm" variant="outline" render={<Link to="/" />}>
          Back to Projects
        </Button>
      }
    />
  );
}

function ProjectTodosComponent() {
  const router = useRouter();
  const { projectId } = Route.useParams();
  const { project, todos, error } = Route.useLoaderData();

  async function handleAdd(title: string) {
    const added = await addTodo(projectId, title);
    if (added) await router.invalidate();
    return added;
  }

  async function handleToggle(id: number, completed: boolean) {
    if (await setTodoCompleted(id, completed)) await router.invalidate();
  }

  async function handleDelete(id: number) {
    if (await deleteTodo(id)) await router.invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project?.name ?? "Todos"}
        description="Manage your tasks"
        actions={
          <Button size="sm" variant="outline" render={<Link to="/" />}>
            All projects
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Add a task</CardTitle>
        </CardHeader>
        <CardContent>
          <TodoForm onAdd={handleAdd} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Tasks</h2>
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
          <TodoList todos={todos} onToggle={handleToggle} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}
