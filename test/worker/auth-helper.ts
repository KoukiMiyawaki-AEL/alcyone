import { env } from "cloudflare:test";

import app from "../../src/worker";

/**
 * Better Auth validates the Origin header, so every request these tests make
 * carries one — the same thing a browser sends. Without it some endpoints
 * (delete-user among them) reject with MISSING_OR_NULL_ORIGIN, which would
 * mean the suite exercised a path no real client takes.
 */
const ORIGIN = env.BETTER_AUTH_URL;

/** Request headers for a signed-in user, ready for a JSON body. */
export function jsonHeaders(session?: Headers): Headers {
  const headers = new Headers(session ?? []);
  headers.set("Content-Type", "application/json");
  headers.set("Origin", ORIGIN);
  return headers;
}

/**
 * Signs a user up through the real Better Auth endpoint and returns the headers
 * needed to act as them.
 *
 * Deliberately goes through the HTTP flow rather than inserting rows and
 * crafting a cookie: the session token is hashed and the cookie is signed, so
 * hand-built sessions would test a fiction. The cost is that these tests
 * actually run scrypt, which is why the worker suite is slower than it was.
 */
export async function signUp(email: string, name = "Test user"): Promise<Headers> {
  const res = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: jsonHeaders(),
      // minPasswordLength is 12 in src/worker/auth.ts.
      body: JSON.stringify({ email, password: PASSWORD, name }),
    },
    env,
  );

  if (!res.ok) {
    throw new Error(`sign-up failed (${res.status}): ${await res.text()}`);
  }

  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-up returned no session cookie");

  // Only the name=value pair matters when replaying it as a request cookie.
  const headers = new Headers({ cookie: cookie.split(";")[0]! });
  headers.set("Origin", ORIGIN);
  return headers;
}

export const PASSWORD = "correct horse battery";

/** Clears every table these tests touch, children before parents. */
export async function resetAll() {
  for (const table of ["todos", "projects", "session", "account", "verification", "user"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}
