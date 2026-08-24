import { Button } from "@/components/ui/button";

import type { TodoSort, TodoStatus } from "../types";

type TodoFiltersProps = {
  status: TodoStatus;
  sort: TodoSort;
  onChange: (next: { status?: TodoStatus; sort?: TodoSort }) => void;
};

const STATUSES: { value: TodoStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
];

const SORTS: { value: TodoSort; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
];

/**
 * Buttons rather than a select: the current view has to be visible at a glance,
 * and each option is a real link-equivalent — the state lives in the URL.
 */
export function TodoFilters({ status, sort, onChange }: TodoFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div role="group" aria-label="Filter by status" className="flex gap-1">
        {STATUSES.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={status === option.value ? "secondary" : "ghost"}
            aria-pressed={status === option.value}
            onClick={() => onChange({ status: option.value })}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div role="group" aria-label="Sort by" className="flex gap-1">
        {SORTS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={sort === option.value ? "secondary" : "ghost"}
            aria-pressed={sort === option.value}
            onClick={() => onChange({ sort: option.value })}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
