import { env } from "cloudflare:test";

import app from "../../src/worker";

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
      headers: { "Content-Type": "application/json" },
      // minPasswordLength is 12 in src/worker/auth.ts.
      body: JSON.stringify({ email, password: "correct horse battery", name }),
    },
    env,
  );

  if (!res.ok) {
    throw new Error(`sign-up failed (${res.status}): ${await res.text()}`);
  }

  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-up returned no session cookie");

  // Only the name=value pair matters when replaying it as a request cookie.
  return new Headers({ cookie: cookie.split(";")[0]! });
}

/** Clears every table these tests touch, children before parents. */
export async function resetAll() {
  for (const table of ["todos", "projects", "session", "account", "verification", "user"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}
