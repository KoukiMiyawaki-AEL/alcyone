import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { newShareToken, SHARE_TTL_SECONDS, type SharedView } from "../../src/worker/share";
import { jsonHeaders, resetAll, signUp, signUpAdmin, uniqueIp, uniqueKey } from "./auth-helper";

async function createProject(headers: Headers, name = "Shared"): Promise<number> {
  const res = await app.request(
    "/api/projects",
    {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ name, key: uniqueKey() }),
    },
    env,
  );
  return ((await res.json()) as { id: number }).id;
}

async function addTodo(headers: Headers, projectId: number, title: string) {
  return app.request(
    `/api/projects/${projectId}/todos`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) },
    env,
  );
}

async function share(headers: Headers, projectId: number): Promise<string> {
  const res = await app.request(
    `/api/projects/${projectId}/share`,
    { method: "POST", headers },
    env,
  );
  return ((await res.json()) as { token: string }).token;
}

/** A request with no session at all, as a stranger with the link would make. */
function publicGet(token: string) {
  return app.request(
    `/api/shared/${token}`,
    { headers: new Headers([["CF-Connecting-IP", uniqueIp()]]) },
    env,
  );
}

describe("share tokens", () => {
  it("are unguessable and URL-safe", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newShareToken()));

    // The token is the only thing protecting the view, so both properties
    // matter: no collisions, and nothing that needs escaping in a URL or a KV
    // key.
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("sharing a project", () => {
  let alice: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
    projectId = await createProject(alice);
  });

  it("lets anyone with the link read it without an account", async () => {
    await addTodo(alice, projectId, "visible to the world");
    const token = await share(alice, projectId);

    const res = await publicGet(token);
    expect(res.status).toBe(200);

    const view = (await res.json()) as SharedView;
    expect(view.project.name).toBe("Shared");
    expect(view.todos.map((t) => t.title)).toEqual(["visible to the world"]);
  });

  it("shows nothing that identifies the owner", async () => {
    // The payload is chosen rather than inherited from the rows: this goes to
    // anyone holding the link.
    await addTodo(alice, projectId, "a task");
    const token = await share(alice, projectId);

    const body = await (await publicGet(token)).text();
    expect(body).not.toContain("alice@example.com");
    expect(body).not.toContain("ownerId");
    expect(body).not.toContain("projectId");
  });

  it("returns the same link when asked twice", async () => {
    // Regenerating would silently break a link already sent to someone.
    const first = await share(alice, projectId);
    const second = await share(alice, projectId);
    expect(second).toBe(first);
  });

  it("reports whether a project is shared", async () => {
    const before = await app.request(`/api/projects/${projectId}/share`, { headers: alice }, env);
    expect(await before.json()).toEqual({ token: null });

    const token = await share(alice, projectId);
    const after = await app.request(`/api/projects/${projectId}/share`, { headers: alice }, env);
    expect(await after.json()).toEqual({ token });
  });

  it("cannot be created for someone else's project", async () => {
    const bob = await signUp("bob@example.com", "Bob");

    const res = await app.request(
      `/api/projects/${projectId}/share`,
      { method: "POST", headers: bob },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("cannot be revoked by someone else", async () => {
    const token = await share(alice, projectId);
    const bob = await signUp("bob@example.com", "Bob");

    const res = await app.request(
      `/api/projects/${projectId}/share`,
      { method: "DELETE", headers: bob },
      env,
    );
    expect(res.status).toBe(404);
    expect((await publicGet(token)).status).toBe(200);
  });

  it("stops working once revoked", async () => {
    const token = await share(alice, projectId);
    expect((await publicGet(token)).status).toBe(200);

    const res = await app.request(
      `/api/projects/${projectId}/share`,
      { method: "DELETE", headers: alice },
      env,
    );
    expect(res.status).toBe(204);

    // The cached snapshot is dropped as part of revoking, so this is immediate
    // here. In production KV is eventually consistent and a replica can answer
    // with the old value for up to the TTL — see ADR 0022.
    expect((await publicGet(token)).status).toBe(404);
  });

  it("answers a revoked token and an invented one identically", async () => {
    // Any difference would be a way to probe for tokens that used to work.
    const token = await share(alice, projectId);
    await app.request(
      `/api/projects/${projectId}/share`,
      { method: "DELETE", headers: alice },
      env,
    );

    const revoked = await publicGet(token);
    const invented = await publicGet(newShareToken());

    expect(revoked.status).toBe(invented.status);
    expect(await revoked.json()).toEqual(await invented.json());
  });

  it("stops working when the project is deleted, without revoking the link", async () => {
    const token = await share(alice, projectId);
    await env.SHARE_CACHE.delete(`share:${token}`);

    await app.request(`/api/projects/${projectId}`, { method: "DELETE", headers: alice }, env);

    expect((await publicGet(token)).status).toBe(404);
  });

  it("rejects a token that could not be one", async () => {
    // The token lands in a KV key, so its shape is checked before it gets there.
    expect((await publicGet("short")).status).toBe(400);
    expect((await app.request("/api/shared/has%20a%20space", {}, env)).status).toBe(400);
  });
});

describe("the KV cache in front of the shared view", () => {
  let alice: Headers;
  let projectId: number;
  let token: string;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
    projectId = await createProject(alice);
    await addTodo(alice, projectId, "first");
    token = await share(alice, projectId);
    await env.SHARE_CACHE.delete(`share:${token}`);
  });

  it("populates the cache on the first read", async () => {
    expect(await env.SHARE_CACHE.get(`share:${token}`)).toBeNull();

    await publicGet(token);

    const cached = await env.SHARE_CACHE.get<SharedView>(`share:${token}`, "json");
    expect(cached?.todos.map((t) => t.title)).toEqual(["first"]);
  });

  it("serves the snapshot rather than the database on the next read", async () => {
    await publicGet(token);

    // Changing the row behind the cache's back. A reader still gets the
    // snapshot — this is the staleness the feature accepts, stated as a test
    // rather than left as a surprise.
    await env.DB.prepare("UPDATE todos SET title = 'changed' WHERE title = 'first'").run();

    const view = (await (await publicGet(token)).json()) as SharedView;
    expect(view.todos.map((t) => t.title)).toEqual(["first"]);
  });

  it("rebuilds from the database once the snapshot is gone", async () => {
    await publicGet(token);
    await env.DB.prepare("UPDATE todos SET title = 'changed' WHERE title = 'first'").run();
    await env.SHARE_CACHE.delete(`share:${token}`);

    const view = (await (await publicGet(token)).json()) as SharedView;
    expect(view.todos.map((t) => t.title)).toEqual(["changed"]);
  });

  it("gives the snapshot an expiry rather than letting it live forever", async () => {
    await publicGet(token);

    const { keys } = await env.SHARE_CACHE.list({ prefix: `share:${token}` });
    expect(keys).toHaveLength(1);
    expect(keys[0]!.expiration).toBeGreaterThan(Date.now() / 1000);
    expect(keys[0]!.expiration).toBeLessThanOrEqual(Date.now() / 1000 + SHARE_TTL_SECONDS + 5);
  });
});
