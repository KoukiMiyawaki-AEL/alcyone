import {
  AlertTriangleIcon,
  CalendarIcon,
  FlagIcon,
  KanbanIcon,
  PlayIcon,
  UserIcon,
} from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TODO_STATUSES } from "@/worker/db/schema";

import { assigneeName } from "../assignee";
import { DUE_LABEL, DUE_TEXT, dueState } from "../due";
import {
  type Assignee,
  type LabelledTodo,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TodoStatus,
} from "../types";
import { LabelChip } from "./LabelChip";

type TodoBoardProps = {
  todos: LabelledTodo[];
  assignees: Assignee[];
  today: string;
  onStatusChange: (id: number, status: TodoStatus) => Promise<void>;
  onEdit: (todo: LabelledTodo) => void;
  /** True when the fetch was capped, so the board is not showing everything. */
  truncated: boolean;
};

/**
 * The same tasks as the list, arranged by where they are rather than by when
 * they were made.
 *
 * Dragging is the fast path and not the only one: HTML5 drag and drop is
 * unreachable by keyboard, so every card also carries a plain menu of the
 * columns it can move to. Making the drag accessible would mean a drag
 * library and its own set of ARIA problems; two working paths cost less and
 * leave nobody out.
 */
export function TodoBoard({
  todos,
  assignees,
  today,
  onStatusChange,
  onEdit,
  truncated,
}: TodoBoardProps) {
  // Which column is under the pointer. Purely visual, but without it a drop
  // target gives no sign it will accept anything.
  const [over, setOver] = useState<TodoStatus | null>(null);

  const columns = TODO_STATUSES.map((status) => {
    const items = todos.filter((todo) => todo.status === status);
    return {
      status,
      items,
      // Surfaced on the column header, because a board exists to answer "where
      // is the work", and "some of it is late" is part of that answer.
      overdue: items.filter((todo) => dueState(todo, today) === "overdue").length,
    };
  });

  async function move(id: number, to: TodoStatus, from: TodoStatus) {
    setOver(null);
    // A drop onto the column a card already sits in is a no-op, not a write.
    if (to === from) return;
    await onStatusChange(id, to);
  }

  return (
    <div className="flex flex-col gap-3">
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          表示はこのプロジェクトの最初の{todos.length}件です。すべては一覧表示で確認できます。
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {columns.map((column) => (
          <section
            key={column.status}
            aria-label={STATUS_LABELS[column.status]}
            className={cn(
              "flex min-h-32 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2 transition-colors",
              over === column.status && "border-primary bg-accent",
            )}
            onDragOver={(event) => {
              // Without preventDefault the browser refuses the drop entirely.
              event.preventDefault();
              setOver(column.status);
            }}
            onDragLeave={() => setOver((current) => (current === column.status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const payload = event.dataTransfer.getData("text/plain");
              const [id, from] = payload.split(":");
              if (id && from) void move(Number(id), column.status, from as TodoStatus);
            }}
          >
            <h3 className="flex items-center justify-between px-1 text-sm font-medium">
              <span className="flex items-center gap-1.5">
                {STATUS_LABELS[column.status]}
                {column.overdue > 0 ? (
                  <Badge variant="destructive" className="text-[10px]">
                    {column.overdue} 期限切れ
                  </Badge>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {column.items.length}
              </span>
            </h3>

            {/*
              The column scrolls rather than the page. A board's whole value is
              seeing every column at once, and a hundred cards in one of them
              would push the others off the bottom of the screen.
            */}
            <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {column.items.map((todo) => (
                <BoardCard
                  key={todo.id}
                  todo={todo}
                  assignees={assignees}
                  today={today}
                  onEdit={onEdit}
                  onStatusChange={onStatusChange}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {todos.length === 0 ? (
        <EmptyState
          icon={KanbanIcon}
          title="No tasks yet"
          description="「タスクを追加」から最初のタスクを作成してください。"
        />
      ) : null}
    </div>
  );
}

function BoardCard({
  todo,
  assignees,
  today,
  onEdit,
  onStatusChange,
}: {
  todo: LabelledTodo;
  assignees: Assignee[];
  today: string;
  onEdit: (todo: LabelledTodo) => void;
  onStatusChange: (id: number, status: TodoStatus) => Promise<void>;
}) {
  const due = dueState(todo, today);

  return (
    <article
      draggable
      onDragStart={(event) => {
        // The current status travels with the id so the drop can tell a real
        // move from a card returned to where it started.
        event.dataTransfer.setData("text/plain", `${todo.id}:${todo.status}`);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-l-2 border-border bg-background p-2.5 text-sm shadow-xs",
        // Only overdue earns the stripe. Marking every state would be a board
        // where nothing stands out.
        due === "overdue" ? "border-l-destructive" : "border-l-border",
      )}
    >
      {/*
        The card's own title is the button: clicking anywhere sensible opens the
        task, and it is reachable by Tab because it is a real button.
      */}
      <button
        type="button"
        onClick={() => onEdit(todo)}
        className="text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {todo.title}
      </button>

      {todo.description ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{todo.description}</p>
      ) : null}

      {/* Directly under the title: on a board, what a task *is* is the first
          thing scanned, and the dates below are the second. */}
      {todo.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {todo.labels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      ) : null}

      {assigneeName(todo.assigneeId, assignees) ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <UserIcon className="size-3" />
          {assigneeName(todo.assigneeId, assignees)}
        </p>
      ) : null}

      {todo.startAt || todo.dueAt || todo.priority > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {todo.startAt ? (
            <span className="flex items-center gap-1" aria-label={`開始日 ${todo.startAt}`}>
              <PlayIcon className="size-3" />
              {todo.startAt}
            </span>
          ) : null}
          {todo.dueAt ? (
            <span
              className={cn("flex items-center gap-1", DUE_TEXT[due])}
              // A colour alone says nothing to a screen reader, so the label
              // carries the meaning too.
              aria-label={`${DUE_LABEL[due]} ${todo.dueAt}`}
            >
              {due === "overdue" ? (
                <AlertTriangleIcon className="size-3" />
              ) : (
                <CalendarIcon className="size-3" />
              )}
              {todo.dueAt}
            </span>
          ) : null}
          {todo.priority > 0 ? (
            <Badge variant="outline" className="gap-1">
              <FlagIcon className="size-3" />
              {PRIORITY_LABELS[todo.priority]}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {/*
        The keyboard path. Buttons rather than a menu: there are three of them
        at most, and a menu would hide the available moves behind an extra
        press for no gain.
      */}
      <div className="flex flex-wrap gap-1 pt-0.5">
        {TODO_STATUSES.filter((status) => status !== todo.status).map((status) => (
          <Button
            key={status}
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            onClick={() => void onStatusChange(todo.id, status)}
            aria-label={`「${todo.title}」を${STATUS_LABELS[status]}へ移動`}
          >
            → {STATUS_LABELS[status]}
          </Button>
        ))}
      </div>
    </article>
  );
}
