import { CalendarIcon, EllipsisVerticalIcon, FlagIcon, TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { PRIORITY_LABELS, type Todo } from "../types";

type TodoRowProps = {
  todo: Todo;
  onToggle: (id: number, completed: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
};

export function TodoRow({ todo, onToggle, onDelete }: TodoRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Checkbox
        checked={todo.completed}
        onCheckedChange={(checked) => onToggle(todo.id, checked === true)}
        aria-label={`Mark "${todo.title}" as ${todo.completed ? "not done" : "done"}`}
      />
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn("text-sm", todo.completed && "text-muted-foreground line-through")}>
          {todo.title}
        </span>

        {todo.dueAt ? (
          <span
            className="flex items-center gap-1 text-xs text-muted-foreground"
            // The raw value is the accessible one: an icon plus a bare date
            // does not say what the date means.
            aria-label={`Due ${todo.dueAt}`}
          >
            <CalendarIcon className="size-3" />
            {todo.dueAt}
          </span>
        ) : null}

        {todo.priority > 0 ? (
          <span
            className="flex items-center gap-1 text-xs text-muted-foreground"
            aria-label={`Priority: ${PRIORITY_LABELS[todo.priority]}`}
          >
            <FlagIcon className="size-3" />
            {PRIORITY_LABELS[todo.priority]}
          </span>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for "${todo.title}"`}>
              <EllipsisVerticalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(todo.id)}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
