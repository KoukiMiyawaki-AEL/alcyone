import { apiClient } from "@/lib/api-client";
import { mutate } from "@/lib/mutate";

export const addProject = (name: string) =>
  mutate(
    () => apiClient.api.projects.$post({ json: { name } }),
    "プロジェクトの追加に失敗しました。",
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
