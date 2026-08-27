import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { recordServerError, recordShareView } from "../../src/worker/analytics";
import { jsonHeaders, resetAll, signUp, uniqueIp, uniqueKey } from "./auth-helper";

/**
 * Records what would have been written.
 *
 * There is no way to read a dataset back — not from the Worker and not from a
 * test — so the events are captured at the boundary. That is the only place
 * their shape can be pinned, and the shape is the part that cannot be fixed
 * later.
 */
function fakeAnalytics() {
  const points: AnalyticsEngineDataPoint[] = [];
  const dataset = {
    writeDataPoint: (point?: AnalyticsEngineDataPoint) => {
      if (point) points.push(point);
    },
  } as unknown as AnalyticsEngineDataset;
  return { dataset, points };
}

describe("the event schema", () => {
  it("keeps share views at fixed positions", () => {
    // A dataset is append-only and unversioned: blobs[1] is stored as `blob2`
    // forever. Reordering these silently changes the meaning of every row
    // already written, and nothing in the data says so — which is why this
    // reads like an over-specified test.
    const { dataset, points } = fakeAnalytics();

    recordShareView(dataset, "tok-abc", "hit");

    expect(points).toEqual([{ indexes: ["tok-abc"], blobs: ["share_view", "hit"], doubles: [1] }]);
  });

  it("keeps server errors at fixed positions", () => {
    const { dataset, points } = fakeAnalytics();

    recordServerError(dataset, { path: "/api/projects", method: "POST", requestId: "req-1" });

    expect(points).toEqual([
      {
        indexes: ["/api/projects"],
        blobs: ["server_error", "POST", "req-1"],
        doubles: [1],
      },
    ]);
  });

  it("writes an empty string rather than nothing for a missing request id", () => {
    // Positions are fixed, so a gap would shift every later blob by one.
    const { dataset, points } = fakeAnalytics();

    recordServerError(dataset, { path: "/x", method: "GET", requestId: undefined });

    expect(points[0]!.blobs).toEqual(["server_error", "GET", ""]);
  });

  it("truncates an index to what the platform will keep", () => {
    // Cloudflare cuts an index past 96 bytes. Doing it here means the limit is
    // visible where the value is chosen instead of being discovered in a query
    // that quietly groups two things together.
    const { dataset, points } = fakeAnalytics();

    recordShareView(dataset, "x".repeat(200), "miss");

    expect(points[0]!.indexes![0]).toHaveLength(96);
  });

  it("cannot break the error handler it runs inside", async () => {
    // Regression. `recordServerError` runs inside `app.onError`, where an
    // exception has nowhere to go — Hono's last resort is the thing that just
    // threw. A missing binding is enough to cause it, and a missing binding is
    // exactly what an error handler tends to be dealing with.
    const broken = {
      writeDataPoint: () => {
        throw new Error("dataset unavailable");
      },
    } as unknown as AnalyticsEngineDataset;

    expect(() =>
      recordServerError(broken, { path: "/x", method: "GET", requestId: "r" }),
    ).not.toThrow();
    expect(() => recordShareView(undefined, "tok", "hit")).not.toThrow();
  });

  it("records nothing that identifies the reader", () => {
    // This counts reads. Turning it into a record of who read what is a
    // different feature with different obligations, so the absence is asserted
    // rather than assumed.
    const { dataset, points } = fakeAnalytics();

    recordShareView(dataset, "tok", "hit");

    const written = JSON.stringify(points);
    expect(written).not.toMatch(/ip|agent|user/i);
  });
});

describe("events the running Worker emits", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
  });

  async function shareAProject(): Promise<string> {
    const created = await app.request(
      "/api/projects",
      {
        method: "POST",
        headers: jsonHeaders(alice),
        body: JSON.stringify({ name: "P", key: uniqueKey() }),
      },
      env,
    );
    const { id } = (await created.json()) as { id: number };
    const res = await app.request(
      `/api/projects/${id}/share`,
      { method: "POST", headers: alice },
      env,
    );
    return ((await res.json()) as { token: string }).token;
  }

  function publicGet(token: string, dataset: AnalyticsEngineDataset) {
    return app.request(
      `/api/shared/${token}`,
      { headers: new Headers([["CF-Connecting-IP", uniqueIp()]]) },
      { ...env, ANALYTICS: dataset },
    );
  }

  it("tells a cache miss from a hit", async () => {
    // The distinction is the whole reason the event has an outcome: without it
    // there is no way to know whether the KV layer is earning anything.
    const token = await shareAProject();
    await env.SHARE_CACHE.delete(`share:${token}`);

    const { dataset, points } = fakeAnalytics();
    await publicGet(token, dataset);
    await publicGet(token, dataset);

    expect(points.map((p) => p.blobs![1])).toEqual(["miss", "hit"]);
  });

  it("records a read of a token that does not exist", async () => {
    // Worth counting: a rise in these is what someone guessing tokens looks
    // like, and the 404 itself says nothing to anyone watching.
    const { dataset, points } = fakeAnalytics();

    await publicGet("a".repeat(32), dataset);

    expect(points[0]!.blobs).toEqual(["share_view", "not_found"]);
  });

  it("records an unhandled failure with the path that failed", async () => {
    const { dataset, points } = fakeAnalytics();

    // No DB binding -> the auth middleware throws -> onError.
    const res = await app.request("/api/projects", { headers: alice }, {
      ...env,
      DB: undefined,
      ANALYTICS: dataset,
    } as unknown as typeof env);

    expect(res.status).toBe(500);
    expect(points[0]!.indexes).toEqual(["/api/projects"]);
    expect(points[0]!.blobs![0]).toBe("server_error");
  });
});
