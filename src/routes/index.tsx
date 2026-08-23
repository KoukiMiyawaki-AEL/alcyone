import { createFileRoute, useRouter } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { addTodo, deleteTodo, setTodoCompleted } from "@/features/todos/api";
import { TodoForm } from "@/features/todos/components/TodoForm";
import { TodoList } from "@/features/todos/components/TodoList";
import type { Todo } from "@/features/todos/types";
import { apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/")({
  loader: async (): Promise<{ todos: Todo[]; error: string | null }> => {
    try {
      const res = await apiClient.api.todos.$get();
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      return { todos: await res.json(), error: null };
    } catch {
      return { todos: [], error: "タスクの取得に失敗しました。" };
    }
  },
  pendingComponent: TodosPending,
  component: IndexComponent,
});

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

function IndexComponent() {
  const router = useRouter();
  const { todos, error } = Route.useLoaderData();

  async function handleAdd(title: string) {
    const added = await addTodo(title);
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
      <PageHeader title="Todos" description="Manage your tasks" />

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
