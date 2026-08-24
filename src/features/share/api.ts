import { apiClient } from "@/lib/api-client";
import { mutate } from "@/lib/mutate";

/**
 * Creating a share needs the token back, not just success, so this does not go
 * through `mutate()` — it reports its own failure instead. Everything that only
 * needs to know whether it worked still goes through the wrapper.
 */
export async function createShareLink(projectId: number): Promise<string | null> {
  let token: string | null = null;

  const ok = await mutate(async () => {
    const res = await apiClient.api.projects[":projectId"].share.$post({
      param: { projectId: String(projectId) },
    });
    if (res.ok) token = (await res.json()).token;
    return res;
  }, "共有リンクを作成できませんでした。");

  return ok ? token : null;
}

export const revokeShareLink = (projectId: number) =>
  mutate(
    () =>
      apiClient.api.projects[":projectId"].share.$delete({
        param: { projectId: String(projectId) },
      }),
    "共有リンクを解除できませんでした。",
  );
