import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { jsonHeaders, PASSWORD, resetAll, signUpAdmin, uniqueIp } from "./auth-helper";

/**
 * The limiter is per-Cloudflare-location and eventually consistent — Cloudflare
 * says outright it is "not an accurate accounting system". These tests assert
 * that it engages and that the response is well formed, not that it counts
 * precisely, because that is not a promise the platform makes.
 *
 * The attempts go out together rather than one after another. Sent
 * sequentially they can straddle the end of the limiter's window, at which
 * point the count resets and nothing is ever rejected — which failed once,
 * only inside the full `check`, and looked like the limiter had stopped
 * working. Getting it to reject is setup here; what is asserted is what it
 * says when it does.
 */
describe("rate limiting", () => {
  beforeEach(resetAll);

  /** One burst of failed sign-ins from a single address, all in flight at once. */
  const burst = (ip: string, attempts = 20) =>
    Promise.all(
      Array.from({ length: attempts }, () =>
        app.request(
          "/api/auth/sign-in/email",
          {
            method: "POST",
            headers: jsonHeaders(undefined, ip),
            body: JSON.stringify({ email: "nobody@example.com", password: "wrong password here" }),
          },
          env,
        ),
      ),
    );

  it("eventually rejects repeated sign-in attempts", async () => {
    const responses = await burst(uniqueIp());

    expect(responses.map((res) => res.status)).toContain(429);
  });

  it("tells a rejected caller when to come back", async () => {
    const responses = await burst(uniqueIp());
    const rejected = responses.find((res) => res.status === 429);

    expect(rejected).toBeDefined();
    expect(rejected?.headers.get("retry-after")).toBe("60");
    expect(await rejected?.json()).toEqual({ error: "Too Many Requests" });
  });

  it("does not rate limit ordinary reads", async () => {
    const headers = await signUpAdmin("owner@example.com");

    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      statuses.push((await app.request("/api/projects", { headers }, env)).status);
    }

    // Only the endpoints that are expensive or brute-forceable are limited.
    // Limiting normal reads would make the app feel broken under normal use.
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("keeps /api/health reachable", async () => {
    // An uptime monitor polls constantly and must not be throttled out.
    for (let i = 0; i < 20; i += 1) {
      expect((await app.request("/api/health", {}, env)).status).toBe(200);
    }
  });

  it("still lets a legitimate sign-up through", async () => {
    // Guards against setting the limit so low that the happy path trips it.
    const res = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: jsonHeaders(undefined, uniqueIp()),
        body: JSON.stringify({ email: "fresh@example.com", password: PASSWORD, name: "Fresh" }),
      },
      env,
    );
    expect(res.status).toBe(200);
  });
});
