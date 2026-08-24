import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Project } from "../../src/features/projects/types";
import type { Todo } from "../../src/features/todos/types";
import app from "../../src/worker";

async function reset() {
  await env.DB.prepare("DELETE FROM todos").run();
  await env.DB.prepare("DELETE FROM projects").run();
}

async function createProject(name: string): Promise<number> {
  const res = await app.request(
    "/api/projects",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    env,
  );
  const { id } = (await res.json()) as Project;
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

async function countTodos(projectId: number): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM todos WHERE projectId = ?")
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("Projects API", () => {
  beforeEach(reset);

  it("creates and lists projects in id order", async () => {
    await createProject("First");
    await createProject("Second");

    const res = await app.request("/api/projects", {}, env);
    expect(res.status).toBe(200);
    const projects = (await res.json()) as Project[];
    expect(projects.map((p) => p.name)).toEqual(["First", "Second"]);
  });

  it("rejects a blank name", async () => {
    const res = await app.request(
      "/api/projects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Bad Request" });
  });

  it("404s listing todos of a project that does not exist", async () => {
    const res = await app.request("/api/projects/999999/todos", {}, env);
    expect(res.status).toBe(404);
  });

  it("400s on a non-numeric project id", async () => {
    const res = await app.request("/api/projects/abc/todos", {}, env);
    expect(res.status).toBe(400);
  });

  it("404s rather than 500 when adding a todo to a missing project", async () => {
    const res = await addTodo(999999, "orphan");
    expect(res.status).toBe(404);
  });

  // The test that fails if anyone forgets a `where`.
  it("scopes todos to their own project", async () => {
    const a = await createProject("A");
    const b = await createProject("B");
    await addTodo(a, "belongs to A");
    await addTodo(b, "belongs to B");

    const resA = await app.request(`/api/projects/${a}/todos`, {}, env);
    const { todos: todosA } = (await resA.json()) as { todos: Todo[] };
    expect(todosA.map((t) => t.title)).toEqual(["belongs to A"]);

    const resB = await app.request(`/api/projects/${b}/todos`, {}, env);
    const { todos: todosB } = (await resB.json()) as { todos: Todo[] };
    expect(todosB.map((t) => t.title)).toEqual(["belongs to B"]);
  });

  it("deletes a project and only its own todos", async () => {
    const doomed = await createProject("Doomed");
    const keeper = await createProject("Keeper");
    await addTodo(doomed, "goes away");
    await addTodo(keeper, "stays");

    const res = await app.request(`/api/projects/${doomed}`, { method: "DELETE" }, env);
    expect(res.status).toBe(204);

    expect(await countTodos(doomed)).toBe(0);
    expect(await countTodos(keeper)).toBe(1);
  });

  it("404s deleting a project that does not exist", async () => {
    const res = await app.request("/api/projects/999999", { method: "DELETE" }, env);
    expect(res.status).toBe(404);
  });

  it("enforces the foreign key at the database level", async () => {
    // Pins "D1 enforces foreign keys" as a fact rather than an assumption. If a
    // migration ever drops the constraint, this is what notices.
    await expect(
      env.DB.prepare("INSERT INTO todos (title, projectId) VALUES ('x', 999999)").run(),
    ).rejects.toThrow();
  });
});
