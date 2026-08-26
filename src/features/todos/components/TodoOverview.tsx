import { AlertTriangleIcon, CalendarClockIcon, CircleDashedIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import { buildOverview } from "../overview";
import type { Assignee, Label, LabelledTodo } from "../types";
import { LabelChip } from "./LabelChip";

/**
 * The project at a glance: how far along, what is late, who is holding what.
 *
 * Every number comes from the rows the other views show, so the summary and the
 * list can never disagree. It therefore summarises the page that was loaded —
 * said out loud below rather than left to be discovered.
 */
export function TodoOverview({
  todos,
  labels,
  assignees,
  today,
  truncated,
  onOpen,
}: {
  todos: LabelledTodo[];
  labels: Label[];
  assignees: Assignee[];
  today: string;
  truncated: boolean;
  onOpen: (todo: LabelledTodo) => void;
}) {
  const overview = buildOverview(todos, labels, assignees, today);

  if (overview.total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        まだタスクがありません。「タスクを追加」から始めてください。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>進捗</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Progress value={overview.percent} aria-label="プロジェクトの進捗" />
          <p className="text-sm tabular-nums">
            {overview.done} / {overview.total} 完了（{overview.percent}%）
          </p>

          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {overview.byStatus.map((bucket) => (
              <div key={bucket.key} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{bucket.label}</span>
                <span className="font-medium tabular-nums">{bucket.count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <AttentionCard
          title="期限切れ"
          icon={AlertTriangleIcon}
          tone="text-destructive"
          todos={overview.overdue}
          empty="期限を過ぎたタスクはありません。"
          onOpen={onOpen}
        />
        <AttentionCard
          title="まもなく期限"
          icon={CalendarClockIcon}
          tone="text-primary"
          todos={overview.dueSoon}
          empty="直近に期限が来るタスクはありません。"
          onOpen={onOpen}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>担当</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {/*
              Unfinished work only. A person's load is what is still on them,
              not everything they have ever touched.
            */}
            {overview.byAssignee.length === 0 ? (
              <p className="text-sm text-muted-foreground">未完了のタスクはありません。</p>
            ) : (
              overview.byAssignee.map((bucket) => (
                <div key={bucket.key} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{bucket.label}</span>
                  <span className="font-medium tabular-nums">{bucket.count}</span>
                </div>
              ))
            )}
            {overview.unscheduled > 0 ? (
              <p className="flex items-center gap-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
                <CircleDashedIcon className="size-3.5" />
                日付が入っていない未完了のタスク {overview.unscheduled} 件
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ラベル</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {overview.byLabel.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                使われているラベルはありません。設定から追加できます。
              </p>
            ) : (
              overview.byLabel.map((bucket) => (
                <div key={bucket.key} className="flex items-center gap-2">
                  <LabelChip label={bucket.label} />
                  <span className="ml-auto text-sm font-medium tabular-nums">{bucket.count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {truncated ? (
        <p className="text-xs text-muted-foreground">
          この集計は読み込んだ範囲のタスクだけを対象にしています。
        </p>
      ) : null}
    </div>
  );
}

function AttentionCard({
  title,
  icon: Icon,
  tone,
  todos,
  empty,
  onOpen,
}: {
  title: string;
  icon: typeof AlertTriangleIcon;
  tone: string;
  todos: LabelledTodo[];
  empty: string;
  onOpen: (todo: LabelledTodo) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className={`size-4 ${tone}`} />
          {title}
          {todos.length > 0 ? <Badge variant="secondary">{todos.length}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {todos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          todos.map((todo) => (
            <button
              key={todo.id}
              type="button"
              onClick={() => onOpen(todo)}
              className="flex items-center gap-2 text-left text-sm hover:underline focus-visible:underline focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1 truncate">{todo.title}</span>
              <span className={`shrink-0 text-xs tabular-nums ${tone}`}>{todo.dueAt}</span>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}
