import type {
  TodoStatus,
  todoCommentsTable,
  todoEventsTable,
  todosTable,
} from "@/worker/db/schema";

export type Todo = typeof todosTable.$inferSelect;
export type TodoComment = typeof todoCommentsTable.$inferSelect;
export type TodoEvent = typeof todoEventsTable.$inferSelect;

export type { TodoStatus };

/** What a caller may change. `null` clears; omitted leaves alone. */
export type TodoFields = {
  title?: string;
  status?: TodoStatus;
  startAt?: string | null;
  dueAt?: string | null;
  description?: string | null;
  priority?: number;
};

/**
 * What a list is narrowed to — not the same thing as a row's status. "all" and
 * "active" are ways of *not* naming a status, so they live alongside the real
 * ones rather than inside them.
 */
export type TodoFilter = "all" | "active" | TodoStatus;

export type TodoSort = "created" | "due" | "priority" | "start";

/**
 * Labels live next to the values they describe so a new status cannot be added
 * without deciding what to call it.
 */
export const STATUS_LABELS: Record<TodoStatus, string> = {
  todo: "未着手",
  in_progress: "進行中",
  blocked: "ブロック中",
  done: "完了",
};

export const PRIORITY_LABELS = ["None", "Low", "Medium", "High"] as const;

/** How a history row reads. The field names come from the database. */
export const EVENT_LABELS: Record<TodoEvent["field"], string> = {
  created: "作成",
  status: "ステータス",
  startAt: "開始日",
  dueAt: "期限日",
  title: "タイトル",
  priority: "優先度",
  deleted: "削除",
  restored: "復元",
};
