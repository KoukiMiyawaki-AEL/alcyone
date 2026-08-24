import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import app from "../../src/worker";
import { resetAll, signUp } from "./auth-helper";

async function createProject(headers: Headers, name = "Test project"): Promise<number> {
  const res = await app.request(
    "/api/projects",
    {
      method: "POST",
      headers: new Headers([...headers, ["Content-Type", "application/json"]]),
      body: JSON.stringify({ name }),
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
      headers: new Headers([...headers, ["Content-Type", "application/json"]]),
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
      completed: false,
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

  it("toggles completed state", async () => {
    const { id } = (await (await addTodo(headers, projectId, "Ship it")).json()) as Todo;

    const res = await app.request(
      `/api/todos/${id}`,
      {
        method: "PATCH",
        headers: new Headers([...headers, ["Content-Type", "application/json"]]),
        body: JSON.stringify({ completed: true }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, completed: true });
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
        headers: new Headers([...headers, ["Content-Type", "application/json"]]),
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
