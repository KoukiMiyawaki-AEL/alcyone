import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp } from "./auth-helper";

async function createProject(headers: Headers): Promise<number> {
  const res = await app.request(
    "/api/projects",
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ name: "P" }) },
    env,
  );
  return ((await res.json()) as { id: number }).id;
}

async function addTodo(
  headers: Headers,
  projectId: number,
  title: string,
  details?: { dueAt?: string | null; priority?: number },
): Promise<Todo> {
  const created = (await (
    await app.request(
      `/api/projects/${projectId}/todos`,
      { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) },
      env,
    )
  ).json()) as Todo;

  if (!details) return created;

  return (await (
    await app.request(
      `/api/todos/${created.id}/details`,
      { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify(details) },
      env,
    )
  ).json()) as Todo;
}

async function list(headers: Headers, projectId: number, query = ""): Promise<string[]> {
  const res = await app.request(`/api/projects/${projectId}/todos${query}`, { headers }, env);
  const { todos } = (await res.json()) as { todos: Todo[] };
  return todos.map((t) => t.title);
}

describe("todo filtering and sorting", () => {
  let headers: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    headers = await signUp("owner@example.com");
    projectId = await createProject(headers);
  });

  it("defaults to every todo in creation order", async () => {
    await addTodo(headers, projectId, "first");
    await addTodo(headers, projectId, "second");

    expect(await list(headers, projectId)).toEqual(["first", "second"]);
  });

  it("filters by status", async () => {
    const done = await addTodo(headers, projectId, "done one");
    await addTodo(headers, projectId, "still open");
    await app.request(
      `/api/todos/${done.id}`,
      { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify({ completed: true }) },
      env,
    );

    expect(await list(headers, projectId, "?status=active")).toEqual(["still open"]);
    expect(await list(headers, projectId, "?status=done")).toEqual(["done one"]);
    expect(await list(headers, projectId, "?status=all")).toHaveLength(2);
  });

  it("sorts by due date, putting undated todos last", async () => {
    await addTodo(headers, projectId, "no date");
    await addTodo(headers, projectId, "later", { dueAt: "2026-12-31" });
    await addTodo(headers, projectId, "sooner", { dueAt: "2026-01-01" });

    // SQLite would sort NULL first if left alone; undated todos are not the
    // most urgent, so this asserts the intended order rather than the default.
    expect(await list(headers, projectId, "?sort=due")).toEqual(["sooner", "later", "no date"]);
  });

  it("sorts by priority, highest first", async () => {
    await addTodo(headers, projectId, "none");
    await addTodo(headers, projectId, "high", { priority: 3 });
    await addTodo(headers, projectId, "low", { priority: 1 });

    expect(await list(headers, projectId, "?sort=priority")).toEqual(["high", "low", "none"]);
  });

  it("breaks ties by id so the order is stable", async () => {
    await addTodo(headers, projectId, "a", { priority: 2 });
    await addTodo(headers, projectId, "b", { priority: 2 });
    await addTodo(headers, projectId, "c", { priority: 2 });

    // Without a tiebreaker these could come back in any order, and the list
    // would appear to shuffle itself between requests.
    expect(await list(headers, projectId, "?sort=priority")).toEqual(["a", "b", "c"]);
  });

  it("rejects an unknown sort or status", async () => {
    for (const query of ["?sort=nonsense", "?status=nonsense"]) {
      const res = await app.request(`/api/projects/${projectId}/todos${query}`, { headers }, env);
      expect(res.status, query).toBe(400);
    }
  });

  it("clears a due date with null, distinct from omitting it", async () => {
    const todo = await addTodo(headers, projectId, "dated", { dueAt: "2026-06-01", priority: 2 });
    expect(todo.dueAt).toBe("2026-06-01");

    const cleared = (await (
      await app.request(
        `/api/todos/${todo.id}/details`,
        { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify({ dueAt: null }) },
        env,
      )
    ).json()) as Todo;

    expect(cleared.dueAt).toBeNull();
    // Omitted fields are left alone.
    expect(cleared.priority).toBe(2);
  });

  it("does not let another user patch details", async () => {
    const todo = await addTodo(headers, projectId, "mine");
    const bob = await signUp("bob@example.com");

    const res = await app.request(
      `/api/todos/${todo.id}/details`,
      { method: "PATCH", headers: jsonHeaders(bob), body: JSON.stringify({ priority: 3 }) },
      env,
    );
    expect(res.status).toBe(404);
  });
});
