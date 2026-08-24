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

  return (
    <div className="rounded-lg border border-border">
      {todos.map((todo, index) => (
        <div key={todo.id}>
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
