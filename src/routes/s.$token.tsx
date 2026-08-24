import { createFileRoute, notFound } from "@tanstack/react-router";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";
import type { SharedView } from "@/worker/share";

/**
 * The one page anyone can open without an account.
 *
 * No `beforeLoad` guard, deliberately — that is the feature. Everything shown
 * comes from the API's own chosen payload, so there is nothing here that could
 * leak more than intended by rendering a field someone forgot about.
 */
export const Route = createFileRoute("/s/$token")({
  loader: async ({ params }): Promise<SharedView> => {
    let res;
    try {
      res = await apiClient.api.shared[":token"].$get({ param: { token: params.token } });
    } catch {
      // Network failure only. `notFound()` throws, so it must be raised outside
      // this catch or it would be swallowed into the generic error card.
      throw new Error("共有ページを読み込めませんでした。");
    }

    if (!res.ok) throw notFound();

    return await res.json();
  },
  component: SharedProjectComponent,
});

function SharedProjectComponent() {
  const { project, todos } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={project.name} description="共有されたタスク一覧（閲覧のみ）" />

      {todos.length === 0 ? (
        <p className="text-sm text-muted-foreground">タスクはありません。</p>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-1 py-2">
            {todos.map((todo, index) => (
              <div
                key={`${todo.title}-${index}`}
                className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
              >
                {todo.completed ? (
                  <CheckCircle2Icon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className={todo.completed ? "text-muted-foreground line-through" : undefined}>
                  {todo.title}
                </span>
                {todo.dueAt && (
                  <span className="ml-auto text-xs text-muted-foreground">{todo.dueAt}</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
