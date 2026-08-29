import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp, signUpAdmin, uniqueKey } from "./auth-helper";

async function createProject(headers: Headers, name = "P"): Promise<number> {
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

async function userId(headers: Headers): Promise<string> {
  const res = await app.request("/api/auth/get-session", { headers }, env);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

describe("assignees", () => {
  let alice: Headers;
  let projectId: number;
  let todo: Todo;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
    projectId = await createProject(alice);
    const res = await app.request(
      `/api/projects/${projectId}/todos`,
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ title: "T" }) },
      env,
    );
    todo = (await res.json()) as Todo;
  });

  it("lists who a project's tasks can go to", async () => {
    // One person today, because a project has one owner. The client asks
    // instead of assuming so the answer can change without it noticing.
    const res = await app.request(`/api/projects/${projectId}/assignees`, { headers: alice }, env);

    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string; name: string }[]).toEqual([
      { id: await userId(alice), name: "Alice" },
    ]);
  });

  it("reports the name as it is now, not as it was at sign-up", async () => {
    await app.request(
      "/api/auth/update-user",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ name: "設計担当" }) },
      env,
    );

    const res = await app.request(`/api/projects/${projectId}/assignees`, { headers: alice }, env);
    expect(((await res.json()) as { name: string }[])[0]?.name).toBe("設計担当");
  });

  it("does not list anyone for a project that is not yours", async () => {
    const bob = await signUp("bob@example.com", "Bob");

    const res = await app.request(`/api/projects/${projectId}/assignees`, { headers: bob }, env);
    expect(await res.json()).toEqual([]);
  });

  it("assigns and unassigns a task", async () => {
    const me = await userId(alice);

    const assigned = await app.request(
      `/api/todos/${todo.id}`,
      { method: "PATCH", headers: jsonHeaders(alice), body: JSON.stringify({ assigneeId: me }) },
      env,
    );
    expect((await assigned.json()) as Todo).toMatchObject({ assigneeId: me });

    const cleared = await app.request(
      `/api/todos/${todo.id}`,
      { method: "PATCH", headers: jsonHeaders(alice), body: JSON.stringify({ assigneeId: null }) },
      env,
    );
    // `null` has to stay expressible, or a task could be assigned and never
    // un-assigned.
    expect((await cleared.json()) as Todo).toMatchObject({ assigneeId: null });
  });

  it("refuses an assignee that is not a user", async () => {
    // The foreign key is the check. Validating against a list in the schema as
    // well would be a second place to keep in step with this one.
    const res = await app.request(
      `/api/todos/${todo.id}`,
      {
        method: "PATCH",
        headers: jsonHeaders(alice),
        body: JSON.stringify({ assigneeId: "not-a-user" }),
      },
      env,
    );

    expect(res.status).toBe(500);
    const row = await env.DB.prepare("SELECT assigneeId FROM todos WHERE id = ?")
      .bind(todo.id)
      .first<{ assigneeId: string | null }>();
    expect(row?.assigneeId).toBeNull();
  });

  it("keeps a task assignable after its assignee is renamed", async () => {
    const me = await userId(alice);
    await app.request(
      `/api/todos/${todo.id}`,
      { method: "PATCH", headers: jsonHeaders(alice), body: JSON.stringify({ assigneeId: me }) },
      env,
    );
    await app.request(
      "/api/auth/update-user",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ name: "改名後" }) },
      env,
    );

    // The task stores an id, so a rename moves the displayed name without
    // touching a single todo row.
    const list = await app.request(`/api/projects/${projectId}/todos`, { headers: alice }, env);
    const { todos } = (await list.json()) as { todos: Todo[] };
    expect(todos[0]?.assigneeId).toBe(me);

    const people = await app.request(
      `/api/projects/${projectId}/assignees`,
      { headers: alice },
      env,
    );
    expect(((await people.json()) as { name: string }[])[0]?.name).toBe("改名後");
  });
});
