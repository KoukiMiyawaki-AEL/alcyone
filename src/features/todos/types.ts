import type { todosTable } from "@/worker/db/schema";

export type Todo = typeof todosTable.$inferSelect;

export type TodoStatus = "all" | "active" | "done";
export type TodoSort = "created" | "due" | "priority";

export const PRIORITY_LABELS = ["None", "Low", "Medium", "High"] as const;
