import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { PASSWORD, jsonHeaders, resetAll, signUp, uniqueIp } from "./auth-helper";

/**
 * The limiter is per-Cloudflare-location and eventually consistent — Cloudflare
 * says outright it is "not an accurate accounting system". These tests assert
 * that it engages and that the response is well formed, not that it counts
 * precisely, because that is not a promise the platform makes.
 */
describe("rate limiting", () => {
  beforeEach(resetAll);

  it("eventually rejects repeated sign-in attempts", async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const res = await app.request(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: jsonHeaders(undefined, ip),
          body: JSON.stringify({ email: "nobody@example.com", password: "wrong password here" }),
        },
        env,
      );
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });

  it("tells a rejected caller when to come back", async () => {
    const ip = uniqueIp();
    let rejected: Response | undefined;
    for (let i = 0; i < 20 && !rejected; i += 1) {
      const res = await app.request(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: jsonHeaders(undefined, ip),
          body: JSON.stringify({ email: "nobody@example.com", password: "wrong password here" }),
        },
        env,
      );
      if (res.status === 429) rejected = res;
    }

    expect(rejected?.headers.get("retry-after")).toBe("60");
    expect(await rejected?.json()).toEqual({ error: "Too Many Requests" });
  });

  it("does not rate limit ordinary reads", async () => {
    const headers = await signUp("owner@example.com");

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
