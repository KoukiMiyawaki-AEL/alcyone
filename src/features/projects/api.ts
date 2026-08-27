import { apiClient } from "@/lib/api-client";
import { mutate } from "@/lib/mutate";

import type { ProjectInput } from "./types";

export const addProject = (values: ProjectInput & { name: string; key: string }) =>
  mutate(
    () => apiClient.api.projects.$post({ json: values }),
    "プロジェクトを追加できませんでした。プロジェクトキーが既に使われているかもしれません。",
  );

export const updateProject = (
  id: number,
  values: ProjectInput & { name?: string; archived?: boolean },
) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].$patch({
        param: { projectId: String(id) },
        json: values,
      }),
    "プロジェクトの設定を保存できませんでした。",
  );

export const deleteProject = (id: number) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].$delete({
        param: { projectId: String(id) },
      }),
    "プロジェクトの削除に失敗しました。",
  );

export const restoreProject = (id: number) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].restore.$post({
        param: { projectId: String(id) },
      }),
    "プロジェクトの復元に失敗しました。",
  );
