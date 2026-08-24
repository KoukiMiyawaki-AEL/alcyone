import {
  CalendarIcon,
  EllipsisVerticalIcon,
  FlagIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
  UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { assigneeName } from "../assignee";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Assignee,
  type Todo,
  type TodoStatus,
} from "../types";

type TodoRowProps = {
  todo: Todo;
  assignees: Assignee[];
  onStatusChange: (id: number, status: TodoStatus) => Promise<void>;
  onEdit: (todo: Todo) => void;
  onDelete: (id: number) => Promise<void>;
};

/**
 * How a status looks. `todo` gets no badge at all — it is the default state,
 * and marking every unstarted task would make the ones that *have* moved
 * harder to spot rather than easier.
 */
const STATUS_VARIANT: Record<TodoStatus, "secondary" | "outline" | "destructive" | null> = {
  todo: null,
  in_progress: "secondary",
  blocked: "destructive",
  done: null,
};

export function TodoRow({ todo, assignees, onStatusChange, onEdit, onDelete }: TodoRowProps) {
  const assignee = assigneeName(todo.assigneeId, assignees);
  const done = todo.status === "done";
  const variant = STATUS_VARIANT[todo.status];

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {/*
        A checkbox still, because finishing something is the one action worth
        making a single click. It writes the same `status` field the dialog
        does — unchecking returns the task to "todo", which is the only
        honest inverse of "done" when the row does not know what it was before.
      */}
      <Checkbox
        className="mt-0.5"
        checked={done}
        onCheckedChange={(checked) => onStatusChange(todo.id, checked === true ? "done" : "todo")}
        aria-label={`「${todo.title}」を${done ? "未完了に戻す" : "完了にする"}`}
      />

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn("text-sm", done && "text-muted-foreground line-through")}>
            {todo.title}
          </span>

          {variant ? (
            <Badge variant={variant} className="text-xs">
              {STATUS_LABELS[todo.status]}
            </Badge>
          ) : null}

          {assignee ? (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              aria-label={`担当: ${assignee}`}
            >
              <UserIcon className="size-3" />
              {assignee}
            </span>
          ) : null}

          {todo.startAt ? (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              aria-label={`開始日 ${todo.startAt}`}
            >
              <PlayIcon className="size-3" />
              {todo.startAt}
            </span>
          ) : null}

          {todo.dueAt ? (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              // The raw value is the accessible one: an icon plus a bare date
              // does not say what the date means.
              aria-label={`期限日 ${todo.dueAt}`}
            >
              <CalendarIcon className="size-3" />
              {todo.dueAt}
            </span>
          ) : null}

          {todo.priority > 0 ? (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              aria-label={`優先度: ${PRIORITY_LABELS[todo.priority]}`}
            >
              <FlagIcon className="size-3" />
              {PRIORITY_LABELS[todo.priority]}
            </span>
          ) : null}
        </div>

        {/*
          One line only. The list is for scanning; the whole note is in the
          dialog, and letting a long one push the next task off the screen
          would make the list worse at the thing it is for.
        */}
        {todo.description ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">{todo.description}</p>
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`「${todo.title}」の操作`}>
              <EllipsisVerticalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(todo)}>
            <PencilIcon />
            詳細を編集
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(todo.id)}>
            <TrashIcon />
            削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
