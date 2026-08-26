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

/**
 * Adds someone by address.
 *
 * The directory of accounts is an administrator's to read, so an owner has no
 * list to pick from — but they do know who they are inviting. The server
 * answers 404 for an address with no account, which is deliberately the same
 * answer it gives for a project the caller cannot manage.
 */
export const addMemberByEmail = (projectId: string, email: string) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].members.$post({
        param: { projectId },
        json: { email },
      }),
    "そのメールアドレスのユーザーが見つかりませんでした。",
  );

export const removeMember = (projectId: string, userId: string) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].members[":userId"].$delete({
        param: { projectId, userId },
      }),
    "参加者を解除できませんでした。",
  );
