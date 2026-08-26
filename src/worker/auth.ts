import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

import { exportPrefix } from "./data-export";
import * as authSchema from "./db/auth-schema";
import { createRepo } from "./db/repo";
import { deleteObjectsNow, listKeys } from "./object-cleanup";

/**
 * Built per request. `env` does not exist at module scope in Workers, and a
 * shared instance would hold a binding across invocations.
 *
 * `basePath` is left at its default `/api/auth`, which lands inside the
 * `/api/*` prefix that `wrangler.jsonc`'s `run_worker_first` already routes to
 * this Worker — so no routing config changes.
 */
export function createAuth(env: CloudflareBindings, db: D1Database | D1DatabaseSession = env.DB) {
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
    // The request's D1 session, so that signing in and then reading that
    // session back cannot land on a replica that has not seen the write yet.
    database: drizzleAdapter(drizzle(db as D1Database), {
      provider: "sqlite",
      schema: authSchema,
    }),
    databaseHooks: {
      user: {
        create: {
          /**
           * The first account to exist becomes the owner.
           *
           * Someone has to be able to grant the role, and nobody can until one
           * exists. The alternatives were worse: an endpoint that grants it is
           * an endpoint that can be called by anyone who reaches it, and a
           * documented SQL command is a product feature that only works if you
           * have a database console.
           *
           * "First" is checked against the table rather than against a flag, so
           * it cannot be re-triggered by deleting the flag — only by deleting
           * every account, which is a different situation entirely.
           */
          before: async (user) => {
            const existing = await env.DB.prepare("SELECT count(*) AS n FROM user").first<{
              n: number;
            }>();

            return { data: { ...user, role: existing?.n === 0 ? "owner" : "member" } };
          },
        },
      },
    },
    user: {
      additionalFields: {
        /**
         * Declared so the column survives the round trip. Better Auth drops
         * fields it has not been told about — including ones a database hook
         * returns — so without this the bootstrap above wrote nothing and every
         * account came out a member.
         *
         * `input: false` is the other half: it means the sign-up and
         * update-user endpoints ignore the field even when it is sent, so the
         * role can only ever be set by the hook or by `repo.roles.set`.
         */
        role: { type: "string", required: false, defaultValue: "member", input: false },
      },
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
          //
          // Deleted here and now rather than queued: "your data is deleted"
          // has to be true when the response is sent, not eventually. Chunked
          // because R2 takes at most 1000 keys per call — an account with more
          // attachments than that used to fail to delete at all.
          const keys = (await repo.ownedAttachmentKeys()).map((row) => row.key);

          // Data exports are the user's own data written back out, so leaving
          // them behind would make "delete my account" false in the most
          // literal way. They have no rows, so they are found by prefix.
          const exports = await listKeys(env.ATTACHMENTS, exportPrefix(user.id));

          const all = [...keys, ...exports];
          if (all.length > 0) {
            await deleteObjectsNow(env.ATTACHMENTS, all);
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
