import type { authClient } from "@/lib/auth-client";

type SessionState = ReturnType<typeof authClient.useSession>;

/**
 * What routes get through the router context.
 *
 * `isPending` matters: on the first render the session is still being fetched,
 * and a guard that treats "not yet known" as "signed out" would bounce a
 * signed-in user to the login screen on every hard reload.
 */
export type AuthState = {
  user: NonNullable<SessionState["data"]>["user"] | null;
  isPending: boolean;
};
