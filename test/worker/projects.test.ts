import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Project } from "../../src/features/projects/types";
import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp } from "./auth-helper";

async function createProject(headers: Headers, name: string): Promise<number> {
  const res = await app.request(
    "/api/projects",
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ name }) },
    env,
  );
  return ((await res.json()) as Project).id;
}

async function addTodo(headers: Headers, projectId: number, title: string): Promise<Todo> {
  const res = await app.request(
    `/api/projects/${projectId}/todos`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) },
    env,
  );
  return (await res.json()) as Todo;
}

/** Live todos — the ones a user would see. */
async function countTodos(projectId: number): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT count(*) AS n FROM todos WHERE projectId = ? AND deletedAt IS NULL",
  )
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Every row, including soft-deleted ones. */
async function countRows(projectId: number): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM todos WHERE projectId = ?")
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("Projects API", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
  });

  it("creates and lists projects in id order", async () => {
    await createProject(alice, "First");
    await createProject(alice, "Second");

    const res = await app.request("/api/projects", { headers: alice }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: Project[] }).items.map((p) => p.name)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("rejects a blank name", async () => {
    const res = await app.request(
      "/api/projects",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ name: "   " }) },
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Bad Request" });
  });

  it("404s listing todos of a project that does not exist", async () => {
    const res = await app.request("/api/projects/999999/todos", { headers: alice }, env);
    expect(res.status).toBe(404);
  });

  it("400s on a non-numeric project id", async () => {
    const res = await app.request("/api/projects/abc/todos", { headers: alice }, env);
    expect(res.status).toBe(400);
  });

  it("404s rather than 500 when adding a todo to a missing project", async () => {
    const res = await app.request(
      "/api/projects/999999/todos",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ title: "orphan" }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("scopes todos to their own project", async () => {
    const a = await createProject(alice, "A");
    const b = await createProject(alice, "B");
    await addTodo(alice, a, "belongs to A");
    await addTodo(alice, b, "belongs to B");

    const res = await app.request(`/api/projects/${a}/todos`, { headers: alice }, env);
    const { todos } = (await res.json()) as { todos: Todo[] };
    expect(todos.map((t) => t.title)).toEqual(["belongs to A"]);
  });

  it("deletes a project and only its own todos", async () => {
    const doomed = await createProject(alice, "Doomed");
    const keeper = await createProject(alice, "Keeper");
    await addTodo(alice, doomed, "goes away");
    await addTodo(alice, keeper, "stays");

    const res = await app.request(
      `/api/projects/${doomed}`,
      { method: "DELETE", headers: alice },
      env,
    );
    expect(res.status).toBe(204);
    expect(await countTodos(doomed)).toBe(0);
    expect(await countTodos(keeper)).toBe(1);

    // Soft delete: the rows are still there, just marked. That is the whole
    // point — a hard delete would make restore impossible.
    expect(await countRows(doomed)).toBe(1);

    // And the project itself is gone from the list rather than from the table.
    const list = await app.request("/api/projects", { headers: alice }, env);
    expect(((await list.json()) as { items: Project[] }).items.map((p) => p.name)).toEqual([
      "Keeper",
    ]);
  });

  it("404s deleting a project that does not exist", async () => {
    const res = await app.request(
      "/api/projects/999999",
      { method: "DELETE", headers: alice },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("enforces the foreign key at the database level", async () => {
    await expect(
      env.DB.prepare("INSERT INTO todos (title, projectId) VALUES ('x', 999999)").run(),
    ).rejects.toThrow();
  });
});

/**
 * The reason this whole change exists. Before auth, `PATCH`/`DELETE
 * /api/todos/:id` matched on the todo id alone, so any signed-in user could
 * walk the (sequential, guessable) id space and edit anyone's rows. These are
 * the regression tests for that; they fail if the ownership subquery in
 * src/worker/db/repo.ts is ever dropped.
 */
describe("cross-user isolation", () => {
  let alice: Headers;
  let bob: Headers;
  let aliceProject: number;
  let aliceTodo: Todo;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    bob = await signUp("bob@example.com", "Bob");
    aliceProject = await createProject(alice, "Alice's project");
    aliceTodo = await addTodo(alice, aliceProject, "Alice's todo");
  });

  it("does not list another user's projects", async () => {
    await createProject(bob, "Bob's project");

    const res = await app.request("/api/projects", { headers: bob }, env);
    const names = ((await res.json()) as { items: Project[] }).items.map((p) => p.name);
    expect(names).toEqual(["Bob's project"]);
  });

  it("does not expose another user's project by id", async () => {
    const res = await app.request(`/api/projects/${aliceProject}/todos`, { headers: bob }, env);
    expect(res.status).toBe(404);
  });

  it("cannot toggle another user's todo by id", async () => {
    const res = await app.request(
      `/api/todos/${aliceTodo.id}`,
      { method: "PATCH", headers: jsonHeaders(bob), body: JSON.stringify({ status: "done" }) },
      env,
    );
    expect(res.status).toBe(404);

    // And the row is genuinely untouched, not merely reported as missing.
    const row = await env.DB.prepare("SELECT status FROM todos WHERE id = ?")
      .bind(aliceTodo.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("todo");
  });

  it("cannot delete another user's todo by id", async () => {
    const res = await app.request(
      `/api/todos/${aliceTodo.id}`,
      { method: "DELETE", headers: bob },
      env,
    );
    expect(res.status).toBe(404);
    expect(await countTodos(aliceProject)).toBe(1);
  });

  it("cannot delete another user's project by id", async () => {
    const res = await app.request(
      `/api/projects/${aliceProject}`,
      { method: "DELETE", headers: bob },
      env,
    );
    expect(res.status).toBe(404);
    expect(await countTodos(aliceProject)).toBe(1);
  });

  it("cannot add a todo to another user's project", async () => {
    const res = await app.request(
      `/api/projects/${aliceProject}/todos`,
      { method: "POST", headers: jsonHeaders(bob), body: JSON.stringify({ title: "intruder" }) },
      env,
    );
    expect(res.status).toBe(404);
    expect(await countTodos(aliceProject)).toBe(1);
  });
});
