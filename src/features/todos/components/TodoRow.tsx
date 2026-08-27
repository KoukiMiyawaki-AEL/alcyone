import {
  AlertTriangleIcon,
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
import { DUE_LABEL, DUE_TEXT, dueState } from "../due";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Assignee,
  type LabelledTodo,
  type TodoStatus,
} from "../types";
import { LabelChip } from "./LabelChip";

type TodoRowProps = {
  todo: LabelledTodo;
  /** The project's key, so a row reads as `ALC-12` rather than as a title. */
  projectKey: string;
  assignees: Assignee[];
  /** Today, as a calendar date. Passed in so a row is a pure function of it. */
  today: string;
  onStatusChange: (id: number, status: TodoStatus) => Promise<void>;
  onEdit: (todo: LabelledTodo) => void;
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

/**
 * One task, on one line.
 *
 * The metadata used to wrap inline after the title, which meant the eye could
 * not run down a column: the assignee was in a different place on every row.
 * It now sits in a fixed order on the right, so scanning works — which matters
 * more than it sounds, since most people scan a list rather than read it.
 *
 * A left border carries the one fact worth seeing without reading: that this
 * task is late.
 */
export function TodoRow({
  todo,
  projectKey,
  assignees,
  today,
  onStatusChange,
  onEdit,
  onDelete,
}: TodoRowProps) {
  const done = todo.status === "done";
  const variant = STATUS_VARIANT[todo.status];
  const assignee = assigneeName(todo.assigneeId, assignees);
  const due = dueState(todo, today);

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-l-2 py-2 pr-2 pl-3",
        // Only overdue earns the border. A rule that highlighted every state
        // would be a list where nothing stands out.
        due === "overdue" ? "border-l-destructive" : "border-l-transparent",
      )}
    >
      {/*
        A checkbox still, because finishing something is the one action worth
        making a single click. It writes the same `status` field the dialog
        does — unchecking returns the task to "todo", which is the only
        honest inverse of "done" when the row does not know what it was before.
      */}
      <Checkbox
        checked={done}
        onCheckedChange={(checked) => onStatusChange(todo.id, checked === true ? "done" : "todo")}
        aria-label={`「${todo.title}」を${done ? "未完了に戻す" : "完了にする"}`}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-sm", done && "text-muted-foreground line-through")}>
          {/*
            Before the title, in a fixed width font: this is the string people
            paste into chat and say out loud, and it is only useful if it is in
            the same place on every row.
          */}
          <span className="mr-2 font-mono text-xs text-muted-foreground">
            {projectKey}-{todo.id}
          </span>
          {todo.title}
        </span>
        {/*
          One line only. The list is for scanning; the whole note is in the
          dialog, and letting a long one push the next task off the screen
          would make the list worse at the thing it is for.
        */}
        {todo.description ? (
          <p className="truncate text-xs text-muted-foreground">{todo.description}</p>
        ) : null}
        {/*
          Under the title rather than beside the dates: labels are about what a
          task *is*, and the right-hand column is about where it stands. Mixing
          the two makes both harder to scan.
        */}
        {todo.labels.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {todo.labels.map((label) => (
              <LabelChip key={label.id} label={label} />
            ))}
          </div>
        ) : null}
      </div>

      {/*
        A fixed order, right-aligned: status, assignee, start, due, priority.
        Every row puts the same fact in the same place, which is what makes a
        column of them scannable.
      */}
      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
        {variant ? (
          <Badge variant={variant} className="text-xs">
            {STATUS_LABELS[todo.status]}
          </Badge>
        ) : null}

        {assignee ? (
          <span className="hidden items-center gap-1 sm:flex" aria-label={`担当: ${assignee}`}>
            <UserIcon className="size-3" />
            {assignee}
          </span>
        ) : null}

        {todo.startAt ? (
          <span className="hidden items-center gap-1 md:flex" aria-label={`開始日 ${todo.startAt}`}>
            <PlayIcon className="size-3" />
            {todo.startAt}
          </span>
        ) : null}

        {todo.dueAt ? (
          <span
            className={cn("flex items-center gap-1", DUE_TEXT[due])}
            // The raw value is the accessible one: an icon plus a bare date
            // does not say what the date means, and neither does a colour.
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
          <span
            className="flex items-center gap-1"
            aria-label={`優先度: ${PRIORITY_LABELS[todo.priority]}`}
          >
            <FlagIcon className="size-3" />
            <span className="hidden sm:inline">{PRIORITY_LABELS[todo.priority]}</span>
          </span>
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
