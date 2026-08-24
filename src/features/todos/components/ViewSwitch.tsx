import { KanbanIcon, ListIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export type TodoView = "list" | "board";

const VIEWS = [
  { value: "list", label: "一覧", icon: ListIcon },
  { value: "board", label: "ボード", icon: KanbanIcon },
] as const;

/**
 * Which arrangement of the same tasks is on screen.
 *
 * `aria-pressed` rather than a radio group: these are two buttons that change
 * what is displayed, not a value being chosen and submitted.
 */
export function ViewSwitch({
  view,
  onChange,
}: {
  view: TodoView;
  onChange: (view: TodoView) => void;
}) {
  return (
    <div role="group" aria-label="表示形式" className="flex gap-1">
      {VIEWS.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={view === option.value ? "secondary" : "ghost"}
          aria-pressed={view === option.value}
          onClick={() => onChange(option.value)}
        >
          <option.icon className="size-4" />
          {option.label}
        </Button>
      ))}
    </div>
  );
}
