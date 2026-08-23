import { toast } from "@/components/ui/toast";
import { apiClient } from "@/lib/api-client";

/**
 * Runs a todo mutation and surfaces failures.
 *
 * Every mutation on this page has the same shape: call the endpoint, and on a
 * non-2xx response (or a network error) tell the user rather than letting the
 * subsequent `router.invalidate()` silently re-render the unchanged list.
 * Returns whether the mutation succeeded so callers can skip the refetch.
 */
async function mutate(
  // The Hono RPC client returns `ClientResponse`, not the platform `Response`,
  // and each endpoint has its own union of status codes — `ok` is all we need.
  request: () => Promise<{ ok: boolean }>,
  errorMessage: string,
): Promise<boolean> {
  try {
    const res = await request();
    if (!res.ok) {
      toast.add({ type: "error", title: errorMessage });
      return false;
    }
    return true;
  } catch {
    toast.add({
      type: "error",
      title: errorMessage,
      description: "サーバーに接続できませんでした。",
    });
    return false;
  }
}

export const addTodo = (title: string) =>
  mutate(() => apiClient.api.todos.$post({ json: { title } }), "タスクの追加に失敗しました。");

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
