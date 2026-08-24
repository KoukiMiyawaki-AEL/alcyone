import { Button } from "@/components/ui/button";

import { STATUS_LABELS, type TodoFilter, type TodoSort } from "../types";

type TodoFiltersProps = {
  status: TodoFilter;
  sort: TodoSort;
  /** The board's columns are already a status filter; two would disagree. */
  showStatus?: boolean;
  onChange: (next: { status?: TodoFilter; sort?: TodoSort }) => void;
};

const STATUSES: { value: TodoFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  // "未完了" rather than one of the real statuses: the common question is
  // "what is still open", which no single status answers.
  { value: "active", label: "未完了" },
  { value: "in_progress", label: STATUS_LABELS.in_progress },
  { value: "blocked", label: STATUS_LABELS.blocked },
  { value: "done", label: STATUS_LABELS.done },
];

const SORTS: { value: TodoSort; label: string }[] = [
  { value: "created", label: "作成順" },
  { value: "start", label: "開始日" },
  { value: "due", label: "期限日" },
  { value: "priority", label: "優先度" },
];

/**
 * Buttons rather than a select: the current view has to be visible at a glance,
 * and each option is a real link-equivalent — the state lives in the URL.
 */
export function TodoFilters({ status, sort, showStatus = true, onChange }: TodoFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {showStatus ? (
        <div role="group" aria-label="ステータスで絞り込む" className="flex gap-1">
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
      ) : null}

      <div role="group" aria-label="並び替え" className="flex gap-1">
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
