import { apiClient } from "@/lib/api-client";
import { mutate } from "@/lib/mutate";

export const addTodo = (projectId: string, title: string) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].todos.$post({
        param: { projectId },
        json: { title },
      }),
    "タスクの追加に失敗しました。",
  );

export const setTodoCompleted = (id: number, completed: boolean) =>
  mutate(
    () =>
      apiClient.api.todos[":id"].$patch({
        param: { id: String(id) },
        json: { completed },
      }),
    "タスクの更新に失敗しました。",
  );

export const deleteTodo = (id: number) =>
  mutate(
    () => apiClient.api.todos[":id"].$delete({ param: { id: String(id) } }),
    "タスクの削除に失敗しました。",
  );
