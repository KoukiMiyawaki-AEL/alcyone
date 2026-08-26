import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DUE_LABEL, DUE_TEXT, dueState, type DueState } from "@/features/todos/due";
import { STATUS_LABELS } from "@/features/todos/types";
import type { AssignedTodo } from "@/features/todos/types";
import { apiClient } from "@/lib/api-client";

const TRANSIENT = "担当タスクを取得できませんでした。";

type LoaderData = { items: AssignedTodo[]; today: string; error: string | null };

/**
 * The buckets, in the order someone would work through them.
 *
 * `later` and `none` are separate because "scheduled, but not yet" and "no date
 * at all" are different situations: the first needs nothing today, the second
 * needs a decision.
 */
const GROUPS: { state: DueState; title: string }[] = [
  { state: "overdue", title: "期限切れ" },
  { state: "today", title: "今日" },
  { state: "soon", title: "まもなく" },
  { state: "later", title: "この先" },
  { state: "none", title: "期限なし" },
];

export const Route = createFileRoute("/my")({
  beforeLoad: ({ context, location }) => {
    if (context.auth.isPending) return;
    if (!context.auth.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  loader: async (): Promise<LoaderData> => {
    // Read once, here, so every row on this page is bucketed against the same
    // day. Computing it per row lets a page rendered across midnight put two
    // tasks with the same date in different groups.
    const today = new Date().toISOString().slice(0, 10);

    let res;
    try {
      res = await apiClient.api.todos.assigned.$get();
    } catch {
      return { items: [], today, error: TRANSIENT };
    }

    if (res.status === 401) throw redirect({ to: "/login", search: { redirect: "/my" } });
    if (!res.ok) return { items: [], today, error: TRANSIENT };

    return { items: (await res.json()).items as AssignedTodo[], today, error: null };
  },
  component: MyTasksComponent,
});

function MyTasksComponent() {
  const router = useRouter();
  const { items, today, error } = Route.useLoaderData();

  if (error) {
    return (
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
    );
  }

  const grouped = GROUPS.map((group) => ({
    ...group,
    todos: items.filter((todo) => dueState(todo, today) === group.state),
  })).filter((group) => group.todos.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="マイタスク"
        description="すべてのプロジェクトから、自分に割り当てられた未完了のタスク"
      />

      {items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2Icon}
          title="担当しているタスクはありません"
          description="プロジェクトでタスクの担当者に指定されると、ここに集まります。"
        />
      ) : (
        grouped.map((group) => (
          <Card key={group.state}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {group.title}
                <Badge variant="secondary">{group.todos.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {group.todos.map((todo) => (
                  <li key={todo.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: String(todo.projectId) }}
                      search={{}}
                      className="min-w-0 flex-1 text-sm font-medium hover:underline"
                    >
                      {todo.title}
                    </Link>
                    {/*
                      Which project this belongs to. Without it the page is a
                      pile of titles with no context, which is the failure mode
                      a cross-project list has and a project's own list does not.
                    */}
                    <Badge variant="outline">{todo.projectName}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {STATUS_LABELS[todo.status]}
                    </span>
                    {todo.dueAt ? (
                      <span className={`text-xs ${DUE_TEXT[dueState(todo, today)]}`}>
                        {DUE_LABEL[dueState(todo, today)]}: {todo.dueAt}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
