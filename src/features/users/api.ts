import { apiClient } from "@/lib/api-client";
import { mutate } from "@/lib/mutate";

export const setUserRole = (userId: string, role: "member" | "admin") =>
  mutate(
    () => apiClient.api.users[":userId"].role.$patch({ param: { userId }, json: { role } }),
    "権限を変更できませんでした。",
  );
