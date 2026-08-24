import { ListTodoIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Separator } from "@/components/ui/separator";

import type { Assignee, Todo, TodoStatus } from "../types";
import { TodoRow } from "./TodoRow";

type TodoListProps = {
  todos: Todo[];
  assignees: Assignee[];
  onStatusChange: (id: number, status: TodoStatus) => Promise<void>;
  onEdit: (todo: Todo) => void;
  onDelete: (id: number) => Promise<void>;
};

export function TodoList({ todos, assignees, onStatusChange, onEdit, onDelete }: TodoListProps) {
  if (todos.length === 0) {
    return (
      <EmptyState
        icon={ListTodoIcon}
        title="No tasks yet"
        description="上のフォームから最初のタスクを追加してください。"
      />
    );
  }

  // Children directly under their parent, one level of indent. Deeper nesting
  // is real in the data but not drawn: a list that indents four levels stops
  // being scannable, and the tree is legible in the detail form.
  //
  // A child whose parent is not in this view — filtered out, or on a later
  // page — stays at the top level rather than disappearing. Hiding a task
  // because of where its parent is would make the list lie about the project.
  const present = new Set(todos.map((todo) => todo.id));
  const ordered = todos.flatMap((todo) =>
    todo.parentId !== null && present.has(todo.parentId)
      ? []
      : [
          { todo, depth: 0 },
          ...todos
            .filter((child) => child.parentId === todo.id)
            .map((child) => ({ todo: child, depth: 1 })),
        ],
  );

  return (
    <div className="rounded-lg border border-border">
      {ordered.map(({ todo, depth }, index) => (
        <div key={todo.id} className={depth > 0 ? "pl-6" : undefined}>
          {index > 0 ? <Separator /> : null}
          <TodoRow
            todo={todo}
            assignees={assignees}
            onStatusChange={onStatusChange}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      ))}
    </div>
  );
}
