import { env } from "cloudflare:test";

import { app } from "../../src/worker";

/**
 * Better Auth validates the Origin header, so every request these tests make
 * carries one — the same thing a browser sends. Without it some endpoints
 * (delete-user among them) reject with MISSING_OR_NULL_ORIGIN, which would
 * mean the suite exercised a path no real client takes.
 */
const ORIGIN = env.BETTER_AUTH_URL;

let ipCounter = 0;

/**
 * A distinct client address per caller.
 *
 * `/api/auth/*` is rate limited by IP, and the limiter's state is not reset
 * between tests. Without this, one file's sign-ups would exhaust the budget and
 * later tests — in other files too — would start failing with 429 for reasons
 * that have nothing to do with what they assert.
 */
export function uniqueIp(): string {
  ipCounter += 1;
  // Two octets, so a file with more sign-ups than 254 stops wrapping back onto
  // an address whose rate-limit window is still open. A wrapped address looks
  // exactly like an application bug: the sign-up fails, and the test that fails
  // is whichever one happened to be unlucky.
  return `203.0.${Math.floor(ipCounter / 254) % 254}.${ipCounter % 254}`;
}

/** Request headers for a signed-in user, ready for a JSON body. */
export function jsonHeaders(session?: Headers, ip?: string): Headers {
  const headers = new Headers(session ?? []);
  headers.set("Content-Type", "application/json");
  headers.set("Origin", ORIGIN);
  if (ip) headers.set("CF-Connecting-IP", ip);
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
      headers: jsonHeaders(undefined, uniqueIp()),
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

/** The account `resetAll` seeds so that no test's own user becomes the owner. */
export const SEED_ADMIN_ID = "seed-admin";

let keyCounter = 0;

/**
 * A project key nothing else in the suite is using.
 *
 * Keys are unique across the instance, so a fixed one would make the second
 * project in any file fail with a 400 — which reads as the endpoint being
 * broken rather than as the test asking for something impossible.
 */
export function uniqueKey(): string {
  keyCounter += 1;
  return `K${keyCounter}`;
}

export const PASSWORD = "correct horse battery";

/**
 * Clears every table these tests touch, children before parents.
 *
 * Then seeds one account, because the first one to exist becomes the owner
 * (src/worker/auth.ts). Without the seed, whichever user a test happened to
 * sign up first would silently hold every permission, and an isolation test
 * would pass while proving nothing. Pass `seedAdmin: false` only to test the
 * bootstrap itself.
 */
export async function resetAll({ seedAdmin = true } = {}) {
  // Order matters: attachments -> todos -> projects -> user. D1 enforces the
  // foreign keys, so a wrong order fails loudly rather than leaving orphans.
  // `todos.parentId` points into `todos`, and SQLite checks foreign keys row
  // by row — deleting a parent before its child fails. Detaching first is
  // cheaper than ordering the rows.
  await env.DB.prepare("UPDATE todos SET parentId = NULL").run();

  for (const table of [
    // Before `todos` and `labels`, both of which it points at.
    "todo_labels",
    "attachments",
    "todo_links",
    "todo_comments",
    "todo_events",
    "todos",
    // A child of `projects`, reached only after `todo_labels` has gone.
    "labels",
    // Also a child of `projects`, and forgetting it fails the delete below
    // rather than leaving orphans — which is the good outcome.
    "shares",
    // Also a child of `projects` *and* of `user`, so it goes before both.
    "project_members",
    "projects",
    "session",
    "account",
    "verification",
    "user",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  // A row rather than a sign-up: it only has to occupy "first account", and
  // hashing a password nobody signs in with would cost every test a scrypt run.
  if (seedAdmin) {
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at)
       VALUES (?, 'Seed', 'seed@example.invalid', 0, 'owner', ?, ?)`,
    )
      .bind(SEED_ADMIN_ID, Date.now(), Date.now())
      .run();
  }
}
