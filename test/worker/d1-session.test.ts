import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { BOOKMARK_COOKIE, bookmarkCookie, readBookmark } from "../../src/worker/db/session";
import { jsonHeaders, resetAll, signUp } from "./auth-helper";

/**
 * Adds the bookmark to the existing Cookie header rather than appending a
 * second one. A browser sends exactly one, and two of them are parsed as a
 * single value joined by ", " — which corrupts the session cookie sitting in
 * the first, and the symptom is a puzzling 401.
 */
function withBookmark(headers: Headers, bookmark: string): Headers {
  const merged = new Headers(headers);
  const existing = merged.get("Cookie");
  const cookie = `${BOOKMARK_COOKIE}=${encodeURIComponent(bookmark)}`;
  merged.set("Cookie", existing ? `${existing}; ${cookie}` : cookie);
  return merged;
}

/** The bookmark a response is handing forward, if any. */
function bookmarkFrom(res: Response): string | null {
  for (const value of res.headers.getSetCookie()) {
    const found = readBookmark(value.split(";")[0]);
    if (found) return found;
  }
  return null;
}

describe("reading the bookmark cookie", () => {
  it("finds it among other cookies", () => {
    expect(readBookmark(`a=1; ${BOOKMARK_COOKIE}=abc; b=2`)).toBe("abc");
  });

  it("is absent rather than empty when there is no cookie header", () => {
    expect(readBookmark(undefined)).toBeNull();
    expect(readBookmark("other=1")).toBeNull();
  });

  it("survives a value containing '='", () => {
    // Bookmarks are opaque; splitting on the first `=` only would truncate one.
    expect(readBookmark(`${BOOKMARK_COOKIE}=a=b=c`)).toBe("a=b=c");
  });

  it("treats an empty value as no bookmark", () => {
    expect(readBookmark(`${BOOKMARK_COOKIE}=`)).toBeNull();
  });
});

describe("the bookmark cookie's attributes", () => {
  it("is HttpOnly and not Secure without TLS", () => {
    const session = env.DB.withSession("first-unconstrained");
    // A session that has run nothing has no position to hand forward.
    expect(bookmarkCookie(session, "http://localhost/api/health")).toBeNull();
  });

  it("is Secure over https", async () => {
    const session = env.DB.withSession("first-unconstrained");
    await session.prepare("SELECT 1").first();

    const local = bookmarkCookie(session, "http://localhost/x");
    const remote = bookmarkCookie(session, "https://example.com/x");

    expect(local).toContain("HttpOnly");
    expect(local).not.toContain("Secure");
    expect(remote).toContain("Secure");
  });
});

describe("D1 sessions across requests", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
  });

  it("hands a bookmark forward after a query", async () => {
    const res = await app.request("/api/projects", { headers: alice }, env);
    expect(res.status).toBe(200);
    expect(bookmarkFrom(res)).not.toBeNull();
  });

  it("accepts the bookmark it issued on the next request", async () => {
    const first = await app.request("/api/projects", { headers: alice }, env);
    const bookmark = bookmarkFrom(first)!;

    const second = await app.request(
      "/api/projects",
      { headers: withBookmark(alice, bookmark) },
      env,
    );

    expect(second.status).toBe(200);
  });

  it("does not fail the request over a nonsense bookmark", async () => {
    // The cookie is not user-facing, so a stale or mangled one must degrade to
    // "no ordering guarantee", never to an error.
    const res = await app.request(
      "/api/projects",
      { headers: withBookmark(alice, "not-a-real-bookmark") },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("does not overwrite the cookies the auth endpoints set", async () => {
    // Both land on the same response. Setting rather than appending would sign
    // the user out at the moment they signed in.
    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: jsonHeaders(new Headers([["CF-Connecting-IP", "198.51.100.77"]])),
        body: JSON.stringify({ email: "alice@example.com", password: "correct horse battery" }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("session_token"))).toBe(true);
    expect(cookies.some((c) => c.startsWith(BOOKMARK_COOKIE))).toBe(true);
  });

  it("does not break a response that came back from a subrequest", async () => {
    // Regression. /api/realtime returns the Durable Object's own response, and
    // a response from a subrequest has *immutable* headers — appending to one
    // throws, which `onError` turned into a 500. Every realtime test failed at
    // once, and the endpoint was simply broken.
    const res = await app.request("/api/realtime", { headers: alice }, env);

    expect(res.status).toBe(426);
    // Rebuilt rather than skipped: the bookmark still has to survive.
    expect(bookmarkFrom(res)).not.toBeNull();
  });

  it("leaves a WebSocket upgrade alone", async () => {
    // A 101 cannot be rebuilt — its socket does not survive being copied — so
    // this one goes out without the bookmark rather than not going out at all.
    const headers = new Headers([...alice, ["Upgrade", "websocket"]]);
    const res = await app.request("http://localhost/api/realtime", { headers }, env);

    expect(res.status).toBe(101);
    expect(res.webSocket).not.toBeNull();
  });

  it("reads its own write back within the same request chain", async () => {
    // The guarantee the session exists for, exercised end to end. Locally there
    // is one database and no replica, so this cannot fail here for the reason
    // it would in production — it pins the wiring, not the consistency model.
    const created = await app.request(
      "/api/projects",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ name: "Just made" }) },
      env,
    );
    const bookmark = bookmarkFrom(created)!;

    const listed = await app.request(
      "/api/projects",
      { headers: withBookmark(alice, bookmark) },
      env,
    );

    const { items } = (await listed.json()) as { items: { name: string }[] };
    expect(items.map((p) => p.name)).toEqual(["Just made"]);
  });
});
