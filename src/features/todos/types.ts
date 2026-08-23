import type { todosTable } from "@/worker/db/schema";

export type Todo = typeof todosTable.$inferSelect;
