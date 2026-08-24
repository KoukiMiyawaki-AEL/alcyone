import { createAuthClient } from "better-auth/react";

/**
 * Same origin as the SPA, so no baseURL is needed — the Worker serves both, and
 * `run_worker_first: ["/api/*"]` routes /api/auth to Better Auth.
 */
export const authClient = createAuthClient();
