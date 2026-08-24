import { toast } from "@/components/ui/toast";

/**
 * Runs a mutation and surfaces failures.
 *
 * Every mutation has the same shape: call the endpoint, and on a non-2xx
 * response (or a network error) tell the user rather than letting the
 * subsequent `router.invalidate()` silently re-render unchanged data.
 * Returns whether the mutation succeeded so callers can skip the refetch.
 */
export async function mutate(
  // The Hono RPC client returns `ClientResponse`, not the platform `Response`,
  // and each endpoint has its own union of status codes — `ok` is all we need.
  request: () => Promise<{ ok: boolean; status?: number }>,
  errorMessage: string,
): Promise<boolean> {
  try {
    const res = await request();
    if (!res.ok) {
      // A 401 here means the session lapsed mid-session. Saying "failed to add"
      // would send the user hunting for a bug that is not there; the route
      // guards will redirect on the next navigation.
      toast.add(
        "status" in res && res.status === 401
          ? {
              type: "error",
              title: "サインインの有効期限が切れました。再度サインインしてください。",
            }
          : { type: "error", title: errorMessage },
      );
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
