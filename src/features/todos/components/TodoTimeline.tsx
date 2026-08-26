import { CalendarRangeIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { assigneeName } from "../assignee";
import {
  ZOOM_DAYS,
  ZOOM_WIDTH,
  applyDrag,
  buildTimeline,
  cells,
  dayNumber,
  monthSpans,
  type DragMode,
  type DragResult,
  type Zoom,
} from "../timeline";
import { STATUS_LABELS, type Assignee, type LabelledTodo, type Todo } from "../types";

type TodoTimelineProps = {
  todos: LabelledTodo[];
  assignees: Assignee[];
  /** Today as a calendar date. Passed in so the view is a pure function of it. */
  today: string;
  /** True when the fetch was capped, so this is not the whole project. */
  truncated: boolean;
  onEdit: (todo: LabelledTodo) => void;
  /** Commits a drag. Resolves to whether the write happened. */
  onReschedule: (id: number, dates: DragResult) => Promise<boolean>;
};

const ZOOM_LABELS: Record<Zoom, string> = { day: "日", week: "週" };

/** How wide a column is, which depends on how much calendar it holds. */
const columnWidth = (zoom: Zoom) => ZOOM_WIDTH[zoom];
/** Pixels per day, which is what turns a pointer movement into a date. */
const dayWidth = (zoom: Zoom) => ZOOM_WIDTH[zoom] / ZOOM_DAYS[zoom];
/** The task-name column, frozen while the axis scrolls under it. */
const LABEL_WIDTH = 200;

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
 * Bars can be dragged to reschedule, which ADR 0026 originally refused on the
 * grounds that turning pixels into dates risks moving a deadline nobody
 * touched. What answers that objection is the grid: a column is exactly one
 * day, so the conversion is integer division with nothing to round wrong. The
 * arithmetic lives in `applyDrag`, tested on its own, and the pending dates are
 * shown while dragging so the write is never a surprise.
 *
 * Dragging is not the only way: the detail form edits the same dates, which is
 * what keeps this reachable without a pointer.
 */
export function TodoTimeline({
  todos,
  assignees,
  today,
  truncated,
  onEdit,
  onReschedule,
}: TodoTimelineProps) {
  // What is being dragged, and how far it has moved so far. Held here rather
  // than per-bar so the whole grid can show the pending dates while it happens.
  // Not in the URL, unlike the view itself. A zoom is how you are looking at
  // the chart right now, not what you are looking at — a link to a project
  // should not carry someone else's magnification.
  const [zoom, setZoom] = useState<Zoom>("day");
  const [drag, setDrag] = useState<{
    id: number;
    mode: DragMode;
    fromX: number;
    deltaDays: number;
  } | null>(null);
  const { from, days, bars, unscheduled, clipped } = buildTimeline(todos, today);
  const columns = cells(from, days, today, zoom);
  const width = columnWidth(zoom);
  const perDay = dayWidth(zoom);

  /** The dates a bar would get if the drag ended now. */
  const pending = (todo: LabelledTodo): DragResult =>
    drag?.id === todo.id
      ? applyDrag(todo, drag.mode, drag.deltaDays)
      : { startAt: todo.startAt, dueAt: todo.dueAt };

  function startDrag(event: React.PointerEvent, todo: LabelledTodo, mode: DragMode) {
    // The bar's own handler would otherwise also fire for an edge and turn a
    // resize into a move.
    event.stopPropagation();
    event.preventDefault();
    setDrag({ id: todo.id, mode, fromX: event.clientX, deltaDays: 0 });
  }

  async function endDrag() {
    if (!drag) return;
    const todo = todos.find((t) => t.id === drag.id);
    setDrag(null);

    // A drag that moved no columns is not a write. Sending one would churn
    // `updatedAt` and tell every other tab to refetch for nothing.
    if (!todo || drag.deltaDays === 0) return;

    await onReschedule(todo.id, applyDrag(todo, drag.mode, drag.deltaDays));
  }

  // Tracked on the window so a fast drag that leaves the bar keeps working,
  // and so releasing anywhere commits rather than stranding the drag.
  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) =>
      setDrag((current) =>
        current === null
          ? null
          : // A column is exactly one day, so this is integer division with
            // nothing to round wrong — the property that makes editing here
            // safe at all.
            (console.log("[drag] move", event.clientX - current.fromX),
            { ...current, deltaDays: Math.round((event.clientX - current.fromX) / perDay) }),
      );

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  });

  if (todos.length === 0) {
    return (
      <EmptyState
        icon={CalendarRangeIcon}
        title="No tasks yet"
        description="「タスクを追加」から最初のタスクを作成してください。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div role="group" aria-label="表示の粒度" className="flex gap-1">
          {(Object.keys(ZOOM_LABELS) as Zoom[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={zoom === option ? "secondary" : "ghost"}
              aria-pressed={zoom === option}
              onClick={() => setZoom(option)}
            >
              {ZOOM_LABELS[option]}
            </Button>
          ))}
        </div>
      </div>

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
      ) : null}

      {
        // Drawn whether or not anything is on it. A calendar with nothing
        // scheduled is the state a plan is made in, and an axis that only
        // appears once a date exists cannot be planned against.

        // The axis is the one thing here that legitimately exceeds the page
        // width, so it scrolls inside its own box rather than pushing the body.
        <div className="overflow-x-auto rounded-lg border border-border">
          <div style={{ width: columns.length * width + LABEL_WIDTH }} className="min-w-full">
            <div
              className="relative grid"
              style={{
                gridTemplateColumns: `${LABEL_WIDTH}px repeat(${columns.length}, ${width}px)`,
              }}
            >
              {/*
                One layer for the weekend and today stripes, instead of a cell
                per day per row. With ninety columns and a hundred tasks that
                would be nine thousand elements to say something the background
                can say once.
              */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 grid"
                style={{
                  gridTemplateColumns: `${LABEL_WIDTH}px repeat(${columns.length}, ${width}px)`,
                }}
              >
                <div />
                {columns.map((day) => (
                  <div
                    key={day.iso}
                    className={cn(
                      day.weekend && "bg-muted/40",
                      day.isToday && "bg-primary/10 ring-1 ring-primary/40 ring-inset",
                    )}
                  />
                ))}
              </div>

              <div className="sticky left-0 z-20 border-r border-b border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                タスク
              </div>
              {monthSpans(from, days, ZOOM_DAYS[zoom]).map((month) => (
                <div
                  key={month.label}
                  style={{ gridColumn: `span ${month.span}` }}
                  className="border-r border-b border-border px-2 py-1.5 text-xs text-muted-foreground tabular-nums"
                >
                  {month.label}
                </div>
              ))}

              {/* The day row: a schedule argued over in weeks needs day numbers. */}
              <div className="sticky left-0 z-20 border-r border-b border-border bg-background" />
              {columns.map((day) => (
                <div
                  key={day.iso}
                  title={day.iso}
                  className={cn(
                    "border-b border-border pb-1 text-center text-[10px] tabular-nums",
                    day.isToday
                      ? "font-semibold text-primary"
                      : day.weekend
                        ? "text-muted-foreground/70"
                        : "text-muted-foreground",
                  )}
                >
                  {day.label}
                </div>
              ))}

              {bars.map((bar) => (
                <div key={bar.todo.id} className="contents">
                  <div className="sticky left-0 z-20 truncate border-r border-b border-border bg-background px-3 py-1.5">
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
                    The whole row as one cell, with the bar positioned inside
                    it. Grid spans cannot express a ghost overlapping its own
                    bar, and a column is a fixed width, so the arithmetic is the
                    same either way.
                  */}
                  <div
                    style={{ gridColumn: `span ${days}` }}
                    className="relative border-b border-border py-1.5"
                  >
                    <div
                      style={{
                        marginLeft: bar.offset * perDay + 1,
                        width: Math.min(bar.length, days - bar.offset) * perDay - 2,
                      }}
                      className={cn(
                        "flex h-4 items-stretch rounded-sm",
                        BAR_CLASS[bar.todo.status],
                        drag?.id === bar.todo.id && "opacity-40",
                      )}
                      // The bar is decoration; the row's name and this label
                      // are what a screen reader gets.
                      title={`${STATUS_LABELS[bar.todo.status]}: ${bar.todo.startAt ?? "—"} 〜 ${bar.todo.dueAt ?? "—"}`}
                      onPointerDown={(event) => startDrag(event, bar.todo, "move")}
                    >
                      {/*
                        Edges resize; the middle moves. Wide enough to hit
                        without being wide enough to swallow a short bar — a
                        one-day bar is DAY_WIDTH across in total.
                      */}
                      <span
                        role="presentation"
                        className="w-1.5 shrink-0 cursor-ew-resize"
                        onPointerDown={(event) => startDrag(event, bar.todo, "start")}
                      />
                      <span className="flex-1 cursor-grab" />
                      <span
                        role="presentation"
                        className="w-1.5 shrink-0 cursor-ew-resize"
                        onPointerDown={(event) => startDrag(event, bar.todo, "end")}
                      />
                    </div>

                    {/*
                      Where it would land. Drawn alongside the faded original so
                      both ends of the change are visible at once — a bar that
                      simply moved would answer "where to" and lose "from
                      where".
                    */}
                    {drag?.id === bar.todo.id ? (
                      <Ghost dates={pending(bar.todo)} from={from} perDay={perDay} />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      }

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

/**
 * Where a dragged bar would land.
 *
 * Positioned in the same pixel arithmetic as the bar itself — a column is a
 * fixed width, so "two columns right" is exactly `2 * DAY_WIDTH`. The dates are
 * printed beside it because a rectangle answers "roughly when" and a schedule
 * argument is about exact days.
 */
function Ghost({ dates, from, perDay }: { dates: DragResult; from: number; perDay: number }) {
  const start = dates.startAt ?? dates.dueAt;
  const end = dates.dueAt ?? dates.startAt;
  if (!start || !end) return null;

  const offset = dayNumber(start) - from;
  const length = dayNumber(end) - dayNumber(start) + 1;

  return (
    <div
      aria-hidden
      style={{ marginLeft: offset * perDay + 1, width: length * perDay - 2 }}
      className="pointer-events-none absolute top-1.5 flex h-4 items-center rounded-sm border-2 border-dashed border-primary bg-primary/20"
    >
      <span className="absolute left-full ml-1.5 rounded bg-popover px-1.5 py-0.5 text-[10px] whitespace-nowrap text-popover-foreground tabular-nums shadow-sm ring-1 ring-border">
        {dates.startAt ?? "—"} 〜 {dates.dueAt ?? "—"}
      </span>
    </div>
  );
}
