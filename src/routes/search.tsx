import { Link, createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { SearchIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import { z } from "zod";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Todo } from "@/features/todos/types";
import { apiClient } from "@/lib/api-client";

const TRANSIENT = "検索に失敗しました。";

/**
 * The query lives in the URL, like every other list state here: a search is
 * worth linking to and worth surviving a reload. `.catch("")` absorbs a hand-
 * edited URL rather than throwing at the router.
 */
const searchSchema = z.object({
  q: z.string().catch(""),
});

export const Route = createFileRoute("/search")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }): Promise<{ todos: Todo[]; error: string | null }> => {
    // An empty box is not a search. The API rejects it, and asking would just
    // be a round trip to be told so.
    if (deps.q.trim() === "") return { todos: [], error: null };

    let res;
    try {
      res = await apiClient.api.search.$get({ query: { q: deps.q } });
    } catch {
      // Network failure only — `redirect()` throws, so it must not be raised
      // inside this catch or it would be swallowed into the error card.
      return { todos: [], error: TRANSIENT };
    }

    if (res.status === 401) {
      throw redirect({ to: "/login", search: { redirect: `/search?q=${deps.q}` } });
    }
    if (!res.ok) return { todos: [], error: TRANSIENT };

    // First page only, like the other lists. Recorded in the readiness map
    // rather than left for someone to discover.
    return { todos: (await res.json()).items, error: null };
  },
  pendingComponent: SearchPending,
  component: SearchComponent,
});

function SearchPending() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Search" description="Find a task across every project" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    </div>
  );
}

function SearchComponent() {
  const router = useRouter();
  const navigate = useNavigate({ from: Route.fullPath });
  const { q } = Route.useSearch();
  const { todos, error } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Search" description="Find a task across every project" />

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("q");
          void navigate({ search: { q: typeof value === "string" ? value : "" } });
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="search-query">Search</Label>
          {/*
            Uncontrolled, and keyed by the URL. The field only needs to be read
            on submit, so holding it in state would buy nothing and cost a
            render per keystroke. `key` makes the Back button move the field
            too: a new `q` remounts the input with the new default.
          */}
          <Input
            key={q}
            id="search-query"
            name="q"
            defaultValue={q}
            placeholder="タイトルの一部で検索"
          />
        </div>
        <Button type="submit">
          <SearchIcon className="size-4" />
          Search
        </Button>
      </form>

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
      ) : q.trim() === "" ? (
        <EmptyState
          icon={SearchIcon}
          title="Search your tasks"
          description="キーワードを入力すると、すべてのプロジェクトを横断して検索します。"
        />
      ) : todos.length === 0 ? (
        <EmptyState
          icon={SearchXIcon}
          title="No matches"
          description={`「${q}」に一致するタスクはありませんでした。`}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {todos.map((todo) => (
            <li key={todo.id}>
              <Button
                variant="outline"
                className="h-auto w-full justify-start px-3 py-2 text-left font-normal"
                render={
                  <Link to="/projects/$projectId" params={{ projectId: String(todo.projectId) }} />
                }
              >
                <span className={todo.status === "done" ? "line-through opacity-60" : undefined}>
                  {todo.title}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
