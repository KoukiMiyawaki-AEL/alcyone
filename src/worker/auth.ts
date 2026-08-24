import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

import * as authSchema from "./db/auth-schema";
import { createRepo } from "./db/repo";

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
    // Set explicitly rather than left to Better Auth's default, which derives
    // the origin from the incoming request's Host header. Nothing embeds those
    // URLs today (no email, no OAuth callbacks), but trusting a client-supplied
    // header for a security-relevant value is not worth carrying forward.
    //
    // The dynamic `{ allowedHosts }` form exists for multi-host setups; this
    // Worker serves the SPA and the API from one origin, so a fixed URL is both
    // simpler and stricter.
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(drizzle(env.DB), {
      provider: "sqlite",
      schema: authSchema,
    }),
    user: {
      deleteUser: {
        enabled: true,
        // Runs before the user row goes. It has to: `projects.ownerId`
        // references `user.id` with NO ACTION (ADR 0012), so deleting the user
        // while they still own projects fails the foreign key. Doing it in
        // `afterDelete` would never be reached.
        //
        // Better Auth's own session and account rows cascade from `user`
        // (ADR 0013), so only the app's tables need handling here.
        beforeDelete: async (user) => {
          const repo = createRepo(env.DB, user.id);

          // Read the keys before the rows go: R2 is not part of the database,
          // so deleting rows would strand the files with nothing pointing at
          // them. Objects go first — a leftover row is recoverable, a leftover
          // object is invisible.
          const keys = (await repo.ownedAttachmentKeys()).map((row) => row.key);
          if (keys.length > 0) {
            await env.ATTACHMENTS.delete(keys);
          }

          await repo.batch(repo.purgeOwnedData());
        },
      },
    },
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
