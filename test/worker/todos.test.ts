import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import app from "../../src/worker";

/**
 * Children before the parent — the foreign key rejects the other order. The
 * migration seeds an Inbox project, so this also clears that.
 */
async function reset() {
  await env.DB.prepare("DELETE FROM todos").run();
  await env.DB.prepare("DELETE FROM projects").run();
}

/** AUTOINCREMENT keeps climbing across tests, so never assume an id. */
async function createProject(name = "Test project"): Promise<number> {
  const res = await app.request(
    "/api/projects",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    env,
  );
  const { id } = (await res.json()) as { id: number };
  return id;
}

async function addTodo(projectId: number, title: string) {
  return app.request(
    `/api/projects/${projectId}/todos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
    env,
  );
}

describe("Todos API", () => {
  let projectId: number;

  beforeEach(async () => {
    await reset();
    projectId = await createProject();
  });

  it("returns an empty list initially", async () => {
    const res = await app.request(`/api/projects/${projectId}/todos`, {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ todos: [] });
  });

  it("creates and lists a todo", async () => {
    const createRes = await addTodo(projectId, "Write plan");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Todo;
    expect(created).toMatchObject({ title: "Write plan", completed: false, projectId });

    const listRes = await app.request(`/api/projects/${projectId}/todos`, {}, env);
    const { todos } = (await listRes.json()) as { todos: Todo[] };
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ title: "Write plan", completed: false });
  });

  it("rejects an empty title", async () => {
    const res = await addTodo(projectId, "");
    expect(res.status).toBe(400);
  });

  it("toggles completed state", async () => {
    const createRes = await addTodo(projectId, "Ship scaffold");
    const { id } = (await createRes.json()) as Todo;

    const patchRes = await app.request(
      `/api/todos/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      },
      env,
    );
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({ id, completed: true });
  });

  it("deletes a todo", async () => {
    const createRes = await addTodo(projectId, "Temporary");
    const { id } = (await createRes.json()) as Todo;

    const deleteRes = await app.request(`/api/todos/${id}`, { method: "DELETE" }, env);
    expect(deleteRes.status).toBe(204);

    const listRes = await app.request(`/api/projects/${projectId}/todos`, {}, env);
    expect(await listRes.json()).toMatchObject({ todos: [] });
  });

  it("returns a structured 400 when the body is invalid", async () => {
    const res = await addTodo(projectId, "");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Bad Request" });
  });

  it("returns 404 for an unknown /api path", async () => {
    const res = await app.request("/api/nope", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 500 without leaking the error when a binding is missing", async () => {
    // No DB binding -> drizzle throws inside the handler -> app.onError.
    const res = await app.request("/api/projects", {}, {} as typeof env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
  });

  it("returns 404 when updating a missing todo", async () => {
    const res = await app.request(
      "/api/todos/999999",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });
});
