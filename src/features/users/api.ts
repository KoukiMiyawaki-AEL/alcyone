import { apiClient } from "@/lib/api-client";
import { mutate } from "@/lib/mutate";

import type { UserRole } from "./types";

export const setUserRole = (userId: string, role: UserRole) =>
  mutate(
    () => apiClient.api.users[":userId"].role.$patch({ param: { userId }, json: { role } }),
    "権限を変更できませんでした。",
  );

/**
 * Creates an account with a role already on it.
 *
 * There is no email to invite through, so the administrator sets the initial
 * password and hands it over. Recorded rather than dressed up: a password
 * chosen by someone else is a real weakness, and the fix is email delivery.
 */
export const createAccount = (input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}) =>
  mutate(
    () => apiClient.api.users.$post({ json: input }),
    "アカウントを作成できませんでした。メールアドレスが既に使われている可能性があります。",
  );
