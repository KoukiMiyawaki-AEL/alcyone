import { CalendarRangeIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";

import { assigneeName } from "../assignee";
import { buildTimeline, isoFromDayNumber, monthSpans } from "../timeline";
import { STATUS_LABELS, type Assignee, type Todo } from "../types";

type TodoTimelineProps = {
  todos: Todo[];
  assignees: Assignee[];
  /** Today as a calendar date. Passed in so the view is a pure function of it. */
  today: string;
  /** True when the fetch was capped, so this is not the whole project. */
  truncated: boolean;
  onEdit: (todo: Todo) => void;
};

/** One column per day. Narrow enough that a couple of months fit on a laptop. */
const DAY_WIDTH = 26;

/** Bars are coloured by status, so a delayed task is visible without reading it. */
const BAR_CLASS: Record<Todo["status"], string> = {
  todo: "bg-muted-foreground/30",
  in_progress: "bg-primary/70",
  blocked: "bg-destructive/60",
  done: "bg-muted-foreground/20",
};

/**
 * Tasks against a day axis.
 *
 * Deliberately not a general Gantt: there are no dependencies between tasks,
 * no critical path and no resource levelling, because none of those exist in
 * the data. What it does show is the thing start and due dates were added
 * for — how the work sits against the calendar and against each other.
 *
 * Read-only. Dragging a bar to reschedule would mean turning pixels back into
 * dates, and getting that wrong moves a deadline the user did not touch; the
 * detail form edits the same dates with no ambiguity.
 */
export function TodoTimeline({ todos, assignees, today, truncated, onEdit }: TodoTimelineProps) {
  const { from, days, bars, unscheduled, todayOffset, clipped } = buildTimeline(todos, today);

  if (todos.length === 0) {
    return (
      <EmptyState
        icon={CalendarRangeIcon}
        title="No tasks yet"
        description="上のフォームから最初のタスクを追加してください。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          表示はこのプロジェクトの最初の{todos.length}件です。すべては一覧表示で確認できます。
        </p>
      ) : null}

      {clipped ? (
        <p className="text-xs text-muted-foreground">
          期間が長いため、最初の{days}日分だけを表示しています。
        </p>
      ) : null}

      {bars.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          日付が設定されたタスクがまだありません。開始日か期限日を設定すると、ここに並びます。
        </p>
      ) : (
        // The axis is the one thing here that legitimately exceeds the page
        // width, so it scrolls inside its own box rather than pushing the body.
        <div className="overflow-x-auto rounded-lg border border-border">
          <div style={{ width: days * DAY_WIDTH + 200 }} className="min-w-full">
            <div
              className="grid"
              style={{ gridTemplateColumns: `200px repeat(${days}, ${DAY_WIDTH}px)` }}
            >
              <div className="sticky left-0 z-10 border-r border-b border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                タスク
              </div>
              {monthSpans(from, days).map((month) => (
                <div
                  key={month.label}
                  style={{ gridColumn: `span ${month.span}` }}
                  className="border-r border-b border-border px-2 py-1.5 text-xs text-muted-foreground tabular-nums"
                >
                  {month.label}
                </div>
              ))}

              {bars.map((bar) => (
                <div key={bar.todo.id} className="contents">
                  <div className="sticky left-0 z-10 truncate border-r border-b border-border bg-background px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(bar.todo)}
                      className="max-w-full truncate text-left text-sm hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {bar.todo.title}
                    </button>
                    {assigneeName(bar.todo.assigneeId, assignees) ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {assigneeName(bar.todo.assigneeId, assignees)}
                      </span>
                    ) : null}
                  </div>

                  {/*
                    An empty cell before the bar, then the bar spanning its
                    days. Grid placement rather than absolute positioning keeps
                    the row height honest when a title wraps.
                  */}
                  {bar.offset > 0 ? (
                    <div
                      style={{ gridColumn: `span ${bar.offset}` }}
                      className="border-b border-border"
                    />
                  ) : null}
                  <div
                    style={{ gridColumn: `span ${Math.min(bar.length, days - bar.offset)}` }}
                    className="border-b border-border px-0.5 py-1.5"
                  >
                    <div
                      className={cn("h-4 rounded-sm", BAR_CLASS[bar.todo.status])}
                      // The bar is decoration; the row's name and this label
                      // are what a screen reader gets.
                      title={`${STATUS_LABELS[bar.todo.status]}: ${bar.todo.startAt ?? "—"} 〜 ${bar.todo.dueAt ?? "—"}`}
                    />
                  </div>
                  {days - bar.offset - bar.length > 0 ? (
                    <div
                      style={{ gridColumn: `span ${days - bar.offset - bar.length}` }}
                      className="border-b border-border"
                    />
                  ) : null}
                </div>
              ))}
            </div>

            {todayOffset !== null ? (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">
                本日 {isoFromDayNumber(from + todayOffset)} は左から{todayOffset + 1}
                日目の位置です。
              </p>
            ) : null}
          </div>
        </div>
      )}

      {unscheduled.length > 0 ? (
        <details className="rounded-lg border border-border p-3">
          {/*
            Listed rather than omitted. A view that quietly drops undated tasks
            would answer "what is scheduled" while looking like it answered
            "what is there".
          */}
          <summary className="cursor-pointer text-sm text-muted-foreground">
            日付が未設定のタスク（{unscheduled.length}件）
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {unscheduled.map((todo) => (
              <li key={todo.id}>
                <button
                  type="button"
                  onClick={() => onEdit(todo)}
                  className="text-left text-sm hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {todo.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
