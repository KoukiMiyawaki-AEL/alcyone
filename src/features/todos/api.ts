import { apiClient } from "@/lib/api-client";
import { mutate } from "@/lib/mutate";

import type { TodoFields } from "./types";

export const addTodo = (projectId: string, fields: { title: string } & TodoFields) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].todos.$post({
        param: { projectId },
        json: fields,
      }),
    "タスクの追加に失敗しました。",
  );

/**
 * Partial update. Absent keys are left alone and `null` clears a field, so the
 * caller passes only what it means to change — a checkbox sends a status and
 * nothing else, and cannot accidentally blank a description it never showed.
 */
export const updateTodo = (id: number, fields: TodoFields) =>
  mutate(
    () =>
      apiClient.api.todos[":id"].$patch({
        param: { id: String(id) },
        json: fields,
      }),
    "タスクの更新に失敗しました。",
  );

export const deleteTodo = (id: number) =>
  mutate(
    () => apiClient.api.todos[":id"].$delete({ param: { id: String(id) } }),
    "タスクの削除に失敗しました。",
  );

export const restoreTodo = (id: number) =>
  mutate(
    () => apiClient.api.todos[":id"].restore.$post({ param: { id: String(id) } }),
    "タスクの復元に失敗しました。",
  );

export const addComment = (todoId: number, body: string) =>
  mutate(
    () =>
      apiClient.api.todos[":id"].comments.$post({
        param: { id: String(todoId) },
        json: { body },
      }),
    "コメントの投稿に失敗しました。",
  );

export const editComment = (id: number, body: string) =>
  mutate(
    () =>
      apiClient.api.comments[":id"].$patch({
        param: { id: String(id) },
        json: { body },
      }),
    "コメントの更新に失敗しました。",
  );

export const removeComment = (id: number) =>
  mutate(
    () => apiClient.api.comments[":id"].$delete({ param: { id: String(id) } }),
    "コメントの削除に失敗しました。",
  );
