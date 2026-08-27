import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp, uniqueKey } from "./auth-helper";

async function createProject(headers: Headers, name = "Test project"): Promise<number> {
  const res = await app.request(
    "/api/projects",
    {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ name, key: uniqueKey() }),
    },
    env,
  );
  const { id } = (await res.json()) as { id: number };
  return id;
}

async function addTodo(headers: Headers, projectId: number, title: string) {
  return app.request(
    `/api/projects/${projectId}/todos`,
    {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ title }),
    },
    env,
  );
}

describe("Todos API", () => {
  let headers: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    headers = await signUp("owner@example.com");
    projectId = await createProject(headers);
  });

  it("returns an empty list initially", async () => {
    const res = await app.request(`/api/projects/${projectId}/todos`, { headers }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ todos: [] });
  });

  it("creates and lists a todo", async () => {
    const createRes = await addTodo(headers, projectId, "Write plan");
    expect(createRes.status).toBe(201);
    expect((await createRes.json()) as Todo).toMatchObject({
      title: "Write plan",
      status: "todo",
      projectId,
    });

    const listRes = await app.request(`/api/projects/${projectId}/todos`, { headers }, env);
    const { todos } = (await listRes.json()) as { todos: Todo[] };
    expect(todos.map((t) => t.title)).toEqual(["Write plan"]);
  });

  it("rejects an empty title", async () => {
    const res = await addTodo(headers, projectId, "");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Bad Request" });
  });

  it("moves a todo between statuses", async () => {
    const { id } = (await (await addTodo(headers, projectId, "Ship it")).json()) as Todo;

    for (const status of ["in_progress", "blocked", "done", "todo"] as const) {
      const res = await app.request(
        `/api/todos/${id}`,
        { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify({ status }) },
        env,
      );
      expect(res.status).toBe(200);
      expect(await res.json(), status).toMatchObject({ id, status });
    }
  });

  it("rejects a status that is not one of the known ones", async () => {
    const { id } = (await (await addTodo(headers, projectId, "Ship it")).json()) as Todo;

    const res = await app.request(
      `/api/todos/${id}`,
      {
        method: "PATCH",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ status: "almost" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("changes only the fields it was given", async () => {
    // The partial update is what lets the checkbox send a status without
    // blanking a description it never showed the user.
    const { id } = (await (await addTodo(headers, projectId, "Detailed")).json()) as Todo;

    await app.request(
      `/api/todos/${id}`,
      {
        method: "PATCH",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ dueAt: "2026-12-01", description: "先に設計を書く", priority: 3 }),
      },
      env,
    );

    const res = await app.request(
      `/api/todos/${id}`,
      { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify({ status: "done" }) },
      env,
    );

    expect(await res.json()).toMatchObject({
      status: "done",
      dueAt: "2026-12-01",
      description: "先に設計を書く",
      priority: 3,
    });
  });

  it("tells clearing a field apart from leaving it alone", async () => {
    const created = await app.request(
      `/api/projects/${projectId}/todos`,
      {
        method: "POST",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ title: "Scheduled", startAt: "2026-11-01", dueAt: "2026-11-30" }),
      },
      env,
    );
    const { id } = (await created.json()) as Todo;

    const cleared = await app.request(
      `/api/todos/${id}`,
      { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify({ dueAt: null }) },
      env,
    );

    // `null` empties the due date; `startAt` was not mentioned, so it stays.
    expect(await cleared.json()).toMatchObject({ startAt: "2026-11-01", dueAt: null });
  });

  it("refuses a start date after the due date", async () => {
    const { id } = (await (await addTodo(headers, projectId, "Backwards")).json()) as Todo;

    const res = await app.request(
      `/api/todos/${id}`,
      {
        method: "PATCH",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ startAt: "2026-12-02", dueAt: "2026-12-01" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("stores an empty description as nothing at all", async () => {
    // "" and "no description" render identically, so keeping both would be two
    // states the user cannot tell apart.
    const { id } = (await (await addTodo(headers, projectId, "Blank note")).json()) as Todo;

    const res = await app.request(
      `/api/todos/${id}`,
      {
        method: "PATCH",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ description: "   " }),
      },
      env,
    );
    expect(await res.json()).toMatchObject({ description: null });
  });

  it("deletes a todo", async () => {
    const { id } = (await (await addTodo(headers, projectId, "Temporary")).json()) as Todo;

    const deleteRes = await app.request(`/api/todos/${id}`, { method: "DELETE", headers }, env);
    expect(deleteRes.status).toBe(204);

    const listRes = await app.request(`/api/projects/${projectId}/todos`, { headers }, env);
    expect(await listRes.json()).toMatchObject({ todos: [] });
  });

  it("returns 404 when updating a missing todo", async () => {
    const res = await app.request(
      "/api/todos/999999",
      {
        method: "PATCH",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ completed: true }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when deleting a missing todo", async () => {
    const res = await app.request("/api/todos/999999", { method: "DELETE", headers }, env);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown /api path", async () => {
    const res = await app.request("/api/nope", { headers }, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("serves /api/health without a session", async () => {
    // An uptime monitor cannot present credentials, so this one stays open.
    const res = await app.request("/api/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 500 without leaking the error when a binding is missing", async () => {
    // No DB binding -> auth cannot read the session -> app.onError. The point is
    // that the response is opaque, not which layer threw.
    const res = await app.request("/api/projects", { headers }, {} as typeof env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
  });
});
