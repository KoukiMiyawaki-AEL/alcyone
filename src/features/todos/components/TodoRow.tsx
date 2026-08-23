import { EllipsisVerticalIcon, TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { Todo } from "../types";

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
      <span
        className={cn("flex-1 text-sm", todo.completed && "text-muted-foreground line-through")}
      >
        {todo.title}
      </span>
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
