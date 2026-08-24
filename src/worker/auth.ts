import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

import * as authSchema from "./db/auth-schema";

/**
 * Built per request. `env` does not exist at module scope in Workers, and a
 * shared instance would hold a binding across invocations.
 *
 * `basePath` is left at its default `/api/auth`, which lands inside the
 * `/api/*` prefix that `wrangler.jsonc`'s `run_worker_first` already routes to
 * this Worker — so no routing config changes.
 */
export function createAuth(env: CloudflareBindings) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB), {
      provider: "sqlite",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      // There is no email infrastructure in this project — Cloudflare Email
      // Sending is beta and Workers Paid only — so verification and password
      // reset are deliberately off. Recorded as a known limitation in
      // docs/adr/0013-better-auth.md.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;
