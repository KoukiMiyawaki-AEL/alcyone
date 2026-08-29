import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/worker";
import { resetAll, signUpAdmin, uniqueKey } from "./auth-helper";

describe("request id", () => {
  beforeEach(resetAll);

  it("returns one on every response", async () => {
    const res = await app.request("/api/health", {}, env);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("gives each request a distinct id", async () => {
    const a = await app.request("/api/health", {}, env);
    const b = await app.request("/api/health", {}, env);

    expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
  });

  it("honours an incoming id so a trace survives across hops", async () => {
    const res = await app.request(
      "/api/health",
      { headers: { "X-Request-Id": "known-value" } },
      env,
    );
    expect(res.headers.get("x-request-id")).toBe("known-value");
  });

  it("ties an error log back to the response the caller saw", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line) => {
      logged.push(String(line));
    });

    // A session cookie is required to get past the auth middleware, which
    // would otherwise answer 401 before anything touches the database.
    const headers = await signUpAdmin("logs@example.com");
    // No DB binding, so looking that session up throws into onError.
    const res = await app.request("/api/projects", { headers }, {} as typeof env);
    spy.mockRestore();

    expect(res.status).toBe(500);
    const entry = JSON.parse(logged.at(-1)!);
    // The whole point: the id in the log is the one the caller can quote.
    expect(entry.requestId).toBe(res.headers.get("x-request-id"));
    expect(entry.level).toBe("error");
  });

  it("keeps request bodies out of the logs", async () => {
    const logged: string[] = [];
    const headers = await signUpAdmin("bodies@example.com");
    headers.set("Content-Type", "application/json");
    const spy = vi.spyOn(console, "error").mockImplementation((line) => {
      logged.push(String(line));
    });

    await app.request(
      "/api/projects",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "a name that must not be logged", key: uniqueKey() }),
      },
      {} as typeof env,
    );
    spy.mockRestore();

    // Once personal data reaches Workers Logs it cannot be removed within the
    // retention window, so this is checked rather than assumed.
    expect(logged.join("\n")).not.toContain("must not be logged");
  });
});
