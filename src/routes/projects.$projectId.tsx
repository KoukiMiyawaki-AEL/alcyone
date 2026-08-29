import { Link, createFileRoute, notFound, redirect, useRouter } from "@tanstack/react-router";
import { FolderXIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Project } from "@/features/projects/types";
import { ShareCard } from "@/features/share/ShareCard";
import { addTodo, deleteTodo, restoreTodo, setTodoLabels, updateTodo } from "@/features/todos/api";
import { TodoBoard } from "@/features/todos/components/TodoBoard";
import { TodoDetailDialog, type TodoEditor } from "@/features/todos/components/TodoDetailDialog";
import { TodoFilters } from "@/features/todos/components/TodoFilters";
import { TodoList } from "@/features/todos/components/TodoList";
import { TodoOverview } from "@/features/todos/components/TodoOverview";
import { TodoTimeline } from "@/features/todos/components/TodoTimeline";
import { sameLabels } from "@/features/todos/labels";
import type {
  Assignee,
  Label,
  LabelledTodo,
  Todo,
  TodoFields,
  TodoStatus,
} from "@/features/todos/types";
import { apiClient } from "@/lib/api-client";
import { toastUndo } from "@/lib/undo-toast";

type LoaderData = {
  project: Project | null;
  todos: LabelledTodo[];
  assignees: Assignee[];
  /** Every label defined in this project — the filter's options and the picker's. */
  labels: Label[];
  shareToken: string | null;
  error: string | null;
};

/**
 * List state lives in the URL, not in component state.
 *
 * That makes a filtered view linkable and survivable across a reload, and it
 * means the loader re-runs when it changes — the filtering happens in SQL, not
 * by hiding rows the client already fetched. `catch` keeps a hand-edited URL
 * from throwing instead of falling back to the defaults.
 */
const searchSchema = z.object({
  // `default` covers the params being absent — so a plain link to the project
  // needs no search at all. `catch` covers them being present but nonsense,
  // which is what a hand-edited URL produces.
  status: z
    .enum(["all", "active", "todo", "in_progress", "blocked", "done"])
    .default("all")
    .catch("all"),
  sort: z.enum(["created", "due", "start", "priority"]).default("created").catch("created"),
  // The board reads the same rows a different way, so it belongs in the same
  // URL rather than behind a separate route: a link to a filtered board is
  // still a link to this project's tasks.
  view: z.enum(["overview", "list", "board", "timeline"]).default("list").catch("list"),
  // A label id, or nothing. In the URL for the same reasons the others are:
  // linkable, survives a reload, and re-runs the loader so the narrowing
  // happens in SQL. `optional` rather than `default`, because "no label" is
  // the absence of a filter and not a value of one.
  label: z.coerce.number().int().positive().optional().catch(undefined),
});

export type TodoListSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: searchSchema,
  // Without this the loader would not re-run when only the search params
  // change, and the filter would appear to do nothing.
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }): Promise<LoaderData> => {
    let res;
    try {
      res = await apiClient.api.projects[":projectId"].todos.$get({
        param: { projectId: params.projectId },
        query:
          deps.view === "list"
            ? // A query string carries text; the id is a number everywhere else,
              // and `undefined` here means the parameter is simply absent.
              { status: deps.status, sort: deps.sort, label: deps.label?.toString() }
            : {
                // A board shows every column at once, so narrowing to one
                // status would empty three of them — its columns *are* the
                // status filter. The overview counts every status by
                // definition. The timeline keeps it, because "what is blocked,
                // and when" is a real question to ask of a calendar.
                status: deps.view === "timeline" ? deps.status : "all",
                sort: deps.sort,
                // Unlike status, the label filter survives into every view: it
                // narrows *which* tasks, not how they are arranged, so a
                // board of one label is a coherent thing to ask for.
                label: deps.label?.toString(),
                // Neither of these has a "load more", so both stop at one page.
                // A project with more live tasks shows only the first
                // WHOLE_VIEW_LIMIT, which they say out loud rather than leaving
                // it to be discovered.
                limit: String(WHOLE_VIEW_LIMIT),
              },
      });
    } catch {
      // Network failure is transient — show the inline Retry card, not a
      // hard "not found". The project may well exist.
      return {
        project: null,
        todos: [],
        assignees: [],
        labels: [],
        shareToken: null,
        error: TRANSIENT,
      };
    }

    // Everything below is outside the catch on purpose: both `redirect()` and
    // `notFound()` work by throwing, so raising either inside the try above
    // would be swallowed and turned into the generic error card.
    //
    // 400 joins 404 because a non-numeric :projectId fails param validation,
    // which for the user is the same thing as the project not existing.
    if (res.status === 401) {
      throw redirect({ to: "/login", search: { redirect: `/projects/${params.projectId}` } });
    }
    if (res.status === 404 || res.status === 400) throw notFound();

    if (!res.ok)
      return {
        project: null,
        todos: [],
        assignees: [],
        labels: [],
        shareToken: null,
        error: TRANSIENT,
      };

    const { project, todos, labels } = await res.json();

    // Who tasks here can be assigned to. One person today, because a project
    // has one owner — asked for rather than assumed, so the answer can change
    // without this code noticing.
    let assignees: Assignee[] = [];
    try {
      const res = await apiClient.api.projects[":projectId"].assignees.$get({
        param: { projectId: params.projectId },
      });
      if (res.ok) assignees = await res.json();
    } catch {
      // The page works without it; the picker just offers nobody.
    }

    // Fetched separately rather than folded into the todos response: whether a
    // project is shared is not part of reading it, and every list request would
    // otherwise carry a field only one card uses.
    let shareToken: string | null = null;
    try {
      const shareRes = await apiClient.api.projects[":projectId"].share.$get({
        param: { projectId: params.projectId },
      });
      if (shareRes.ok) shareToken = (await shareRes.json()).token;
    } catch {
      // The page is perfectly usable without knowing; the card just shows the
      // un-shared state, and enabling is idempotent so nothing is lost.
    }

    return {
      project,
      todos: todos as LabelledTodo[],
      assignees,
      labels: labels as Label[],
      shareToken,
      error: null,
    };
  },
  pendingComponent: TodosPending,
  component: ProjectTodosComponent,
  notFoundComponent: ProjectNotFound,
});

/**
 * How many tasks the board and the timeline load.
 *
 * Both show everything at once and neither paginates, so this is where they
 * stop. Not a measured number — a guess at "more than a person can hold on one
 * screen, fewer than makes the page heavy".
 */
const WHOLE_VIEW_LIMIT = 100;

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
  const { status, sort, view, label } = Route.useSearch();
  // Read once per render rather than inside the timeline, so the view stays a
  // pure function of its inputs and its layout can be tested without a clock.
  const today = new Date().toISOString().slice(0, 10);
  const navigate = Route.useNavigate();
  const { project, todos, assignees, labels, shareToken, error } = Route.useLoaderData();

  // What the detail dialog is working on — a new task or an existing row. Held
  // as the row itself rather than an id so the dialog opens with values already
  // in it; looking it up again would only be a second chance to look up the
  // wrong one.
  const [editor, setEditor] = useState<TodoEditor | null>(null);

  // What each task carries now, so a save can tell whether the labels actually
  // changed rather than rewriting them on every keystroke's worth of edit.
  const labelsById = new Map(todos.map((todo) => [todo.id, todo.labels.map((l) => l.id)]));

  async function handleSave(fields: TodoFields, todo: Todo | null, labelIds: number[]) {
    // The id is needed either way, and on create it only exists once the row
    // does — which is why `addTodo` resolves to the task rather than a boolean.
    const id = todo
      ? (await updateTodo(todo.id, fields)) && todo.id
      : // `title` is required on create and the form enforces it, but the type
        // cannot know that, so the fallback is here rather than a cast.
        ((await addTodo(projectId, { ...fields, title: fields.title ?? "" }))?.id ?? false);

    if (id === false) return false;

    // A second request, deliberately. Labels are a set on a join table and the
    // task's own fields are columns; folding them into one endpoint would mean
    // a partial update that sometimes replaces a collection wholesale, which is
    // two different meanings of PATCH in one place.
    //
    // Skipped when nothing changed, so a save that only touched the title does
    // not rewrite the label rows and does not fail on a task whose labels the
    // caller never saw.
    const before = todo ? (labelsById.get(todo.id) ?? []) : [];
    if (!sameLabels(before, labelIds)) {
      if (!(await setTodoLabels(id, labelIds))) return false;
    }

    await router.invalidate();
    return true;
  }

  async function handleReschedule(
    id: number,
    dates: { startAt: string | null; dueAt: string | null },
  ) {
    const saved = await updateTodo(id, dates);
    if (saved) await router.invalidate();
    return saved;
  }

  async function handleStatusChange(id: number, status: TodoStatus) {
    if (await updateTodo(id, { status })) await router.invalidate();
  }

  async function handleDelete(id: number) {
    if (!(await deleteTodo(id))) return;
    await router.invalidate();

    toastUndo("タスクを削除しました。", async () => {
      if (await restoreTodo(id)) await router.invalidate();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project?.name ?? "Todos"}
        // The project's own description if it has one — a project is worth
        // describing, and this is where somebody looks for what it is about.
        description={project?.description ?? "Manage your tasks"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              One button, and it opens the whole form. There was a title-only
              field here as the fast path, which assumed a task is usually just
              a line of text — for a list anyone actually plans against it is
              not, and the shortcut mostly produced tasks that had to be opened
              and filled in anyway.
            */}
            <Button size="sm" onClick={() => setEditor({ mode: "create", title: "" })}>
              <PlusIcon className="size-4" />
              タスクを追加
            </Button>
            {project ? <ShareCard projectId={project.id} token={shareToken} /> : null}
            <Button size="sm" variant="outline" render={<Link to="/" />}>
              All projects
            </Button>
          </div>
        }
      />

      <TodoDetailDialog
        editor={editor}
        assignees={assignees}
        siblings={todos}
        labels={labels}
        onOpenChange={(open) => setEditor(open ? editor : null)}
        onSave={handleSave}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {view === "overview" ? "概要" : "タスク"}
          </h2>
          {/*
            No filters on the overview: it is a summary of the project, and a
            summary of a filtered subset answers a question nobody asked. The
            status filter is the list's; the board's columns already are one, so
            offering both would let the two disagree on screen.
          */}
          {view === "overview" ? null : (
            <TodoFilters
              status={status}
              sort={sort}
              labels={labels}
              label={label}
              showStatus={view === "list"}
              // Merging into the existing search keeps the other control's value
              // when one of them changes.
              onChange={(next) => navigate({ search: (prev) => ({ ...prev, ...next }) })}
            />
          )}
        </div>
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
        ) : view === "timeline" ? (
          <TodoTimeline
            todos={todos}
            assignees={assignees}
            today={today}
            truncated={todos.length >= WHOLE_VIEW_LIMIT}
            onEdit={(todo) => setEditor({ mode: "edit", todo })}
            onReschedule={handleReschedule}
          />
        ) : view === "overview" ? (
          <TodoOverview
            todos={todos}
            labels={labels}
            assignees={assignees}
            today={today}
            truncated={todos.length >= WHOLE_VIEW_LIMIT}
            onOpen={(todo) => setEditor({ mode: "edit", todo })}
          />
        ) : view === "board" ? (
          <TodoBoard
            todos={todos}
            assignees={assignees}
            today={today}
            onStatusChange={handleStatusChange}
            onEdit={(todo) => setEditor({ mode: "edit", todo })}
            truncated={todos.length >= WHOLE_VIEW_LIMIT}
          />
        ) : (
          <TodoList
            todos={todos}
            projectKey={project?.key ?? ""}
            assignees={assignees}
            today={today}
            onStatusChange={handleStatusChange}
            onEdit={(todo) => setEditor({ mode: "edit", todo })}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}
