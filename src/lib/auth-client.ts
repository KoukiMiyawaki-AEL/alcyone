import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Same origin as the SPA, so no baseURL is needed — the Worker serves both, and
 * `run_worker_first: ["/api/*"]` routes /api/auth to Better Auth.
 *
 * The session already carries `role` over the wire; this declares it so the
 * types agree. Spelled out rather than inferred from `typeof auth`, because
 * that would pull the Worker's module graph — and its platform types — into the
 * browser build's type-checking for one string field.
 *
 * The client can only read it. `input: false` on the server means no endpoint
 * accepts the field from a request, so a user editing this value in devtools
 * changes what their own UI offers and nothing about what the API allows.
 */
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: { role: { type: "string", required: false, input: false } },
    }),
  ],
});
