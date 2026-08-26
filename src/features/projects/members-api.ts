import { apiClient } from "@/lib/api-client";
import { mutate } from "@/lib/mutate";

export const addMember = (projectId: string, userId: string) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].members.$post({
        param: { projectId },
        json: { userId },
      }),
    "参加者を追加できませんでした。",
  );

export const removeMember = (projectId: string, userId: string) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].members[":userId"].$delete({
        param: { projectId, userId },
      }),
    "参加者を解除できませんでした。",
  );
