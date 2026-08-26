import { apiClient } from "@/lib/api-client";
import { mutate, mutateFor } from "@/lib/mutate";

import type { Label, LabelColor, Todo, TodoFields } from "./types";

/** Resolves to the created task, because the caller usually needs its id. */
export const addTodo = (projectId: string, fields: { title: string } & TodoFields) =>
  mutateFor<Todo>(
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

export const addLink = (todoId: number, toTodoId: number, kind: "blocks" | "related") =>
  mutate(
    () =>
      apiClient.api.todos[":id"].links.$post({
        param: { id: String(todoId) },
        json: { toTodoId, kind },
      }),
    "関連づけに失敗しました。",
  );

export const removeLink = (id: number) =>
  mutate(
    () => apiClient.api.links[":id"].$delete({ param: { id: String(id) } }),
    "関連づけの解除に失敗しました。",
  );

/**
 * Replaces the whole set of labels on a task.
 *
 * A set rather than add/remove calls: the screen knows what the task should end
 * up with, and sending that means two people editing at once cannot interleave
 * into a state neither of them chose.
 */
export const setTodoLabels = (todoId: number, labelIds: number[]) =>
  mutateFor<{ labels: Label[] }>(
    () =>
      apiClient.api.todos[":id"].labels.$put({
        param: { id: String(todoId) },
        json: { labelIds },
      }),
    "ラベルを更新できませんでした。",
  );

export const addLabel = (projectId: string, values: { name: string; color: LabelColor }) =>
  mutate(
    () => apiClient.api.projects[":projectId"].labels.$post({ param: { projectId }, json: values }),
    "ラベルを追加できませんでした。同じ名前が既にあるかもしれません。",
  );

export const updateLabel = (id: number, values: { name?: string; color?: LabelColor }) =>
  mutate(
    () => apiClient.api.labels[":labelId"].$patch({ param: { labelId: String(id) }, json: values }),
    "ラベルを更新できませんでした。",
  );

export const deleteLabel = (id: number) =>
  mutate(
    () => apiClient.api.labels[":labelId"].$delete({ param: { labelId: String(id) } }),
    "ラベルを削除できませんでした。",
  );
