import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp } from "./auth-helper";

type Link = { id: number; kind: string; fromTodoId: number; toTodoId: number };

async function createProject(headers: Headers, name = "P"): Promise<number> {
  const res = await app.request(
    "/api/projects",
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ name }) },
    env,
  );
  return ((await res.json()) as { id: number }).id;
}

async function addTodo(headers: Headers, projectId: number, title: string): Promise<Todo> {
  const res = await app.request(
    `/api/projects/${projectId}/todos`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) },
    env,
  );
  return (await res.json()) as Todo;
}

async function setParent(headers: Headers, id: number, parentId: number | null) {
  return app.request(
    `/api/todos/${id}`,
    { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify({ parentId }) },
    env,
  );
}

async function link(headers: Headers, from: number, toTodoId: number, kind = "related") {
  return app.request(
    `/api/todos/${from}/links`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ toTodoId, kind }) },
    env,
  );
}

async function linksOf(headers: Headers, id: number): Promise<Link[]> {
  const res = await app.request(`/api/todos/${id}/links`, { headers }, env);
  return (await res.json()) as Link[];
}

describe("parent and child", () => {
  let alice: Headers;
  let projectId: number;
  let parent: Todo;
  let child: Todo;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    projectId = await createProject(alice);
    parent = await addTodo(alice, projectId, "親");
    child = await addTodo(alice, projectId, "子");
  });

  it("attaches a task to a parent and detaches it again", async () => {
    const attached = await setParent(alice, child.id, parent.id);
    expect((await attached.json()) as Todo).toMatchObject({ parentId: parent.id });

    const detached = await setParent(alice, child.id, null);
    expect((await detached.json()) as Todo).toMatchObject({ parentId: null });
  });

  it("refuses a task as its own parent", async () => {
    const res = await setParent(alice, child.id, child.id);
    expect(res.status).toBe(400);
  });

  it("refuses a cycle further up the tree", async () => {
    // SQLite cannot express "not an ancestor of itself" as a constraint, so
    // this is the only thing standing between the tree and an infinite walk.
    const grandchild = await addTodo(alice, projectId, "孫");
    await setParent(alice, child.id, parent.id);
    await setParent(alice, grandchild.id, child.id);

    const res = await setParent(alice, parent.id, grandchild.id);
    expect(res.status).toBe(400);

    const row = await env.DB.prepare("SELECT parentId FROM todos WHERE id = ?")
      .bind(parent.id)
      .first<{ parentId: number | null }>();
    expect(row?.parentId).toBeNull();
  });

  it("records the change in the history", async () => {
    await setParent(alice, child.id, parent.id);

    const res = await app.request(`/api/todos/${child.id}/activity`, { headers: alice }, env);
    const { events } = (await res.json()) as {
      events: { field: string; toValue: string | null }[];
    };

    expect(events.at(-1)).toMatchObject({ field: "parentId", toValue: String(parent.id) });
  });

  it("cannot point at a task in someone else's account", async () => {
    const bob = await signUp("bob@example.com", "Bob");
    const theirs = await addTodo(bob, await createProject(bob, "Bob's"), "他人のタスク");

    // The foreign key would happily accept it: it checks existence, not
    // ownership. Answering 404 also keeps the endpoint from reporting whether
    // an id in another account exists.
    const res = await setParent(alice, child.id, theirs.id);
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT parentId FROM todos WHERE id = ?")
      .bind(child.id)
      .first<{ parentId: number | null }>();
    expect(row?.parentId).toBeNull();
  });

  it("lets a parent be deleted and restored with its children still pointing at it", async () => {
    await setParent(alice, child.id, parent.id);

    await app.request(`/api/todos/${parent.id}`, { method: "DELETE", headers: alice }, env);
    await app.request(`/api/todos/${parent.id}/restore`, { method: "POST", headers: alice }, env);

    const row = await env.DB.prepare("SELECT parentId FROM todos WHERE id = ?")
      .bind(child.id)
      .first<{ parentId: number | null }>();
    // Soft delete leaves the row, so the link is intact when it comes back.
    expect(row?.parentId).toBe(parent.id);
  });
});

describe("links between tasks", () => {
  let alice: Headers;
  let projectId: number;
  let a: Todo;
  let b: Todo;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    projectId = await createProject(alice);
    a = await addTodo(alice, projectId, "A");
    b = await addTodo(alice, projectId, "B");
  });

  it("is visible from both ends, stored once", async () => {
    // Writing both directions would be two rows that can disagree.
    await link(alice, a.id, b.id, "related");

    expect(await linksOf(alice, a.id)).toHaveLength(1);
    expect(await linksOf(alice, b.id)).toHaveLength(1);

    const row = await env.DB.prepare("SELECT count(*) AS n FROM todo_links").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("keeps the direction of a blocking link", async () => {
    await link(alice, a.id, b.id, "blocks");

    const [stored] = await linksOf(alice, a.id);
    expect(stored).toMatchObject({ kind: "blocks", fromTodoId: a.id, toTodoId: b.id });
  });

  it("refuses to link a task to itself", async () => {
    const res = await link(alice, a.id, a.id);
    expect(res.status).toBe(500);
  });

  it("refuses the same pair twice", async () => {
    await link(alice, a.id, b.id, "related");
    const again = await link(alice, a.id, b.id, "related");

    expect(again.status).toBe(500);
    const row = await env.DB.prepare("SELECT count(*) AS n FROM todo_links").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("allows the same pair with a different meaning", async () => {
    await link(alice, a.id, b.id, "related");
    const blocking = await link(alice, a.id, b.id, "blocks");

    expect(blocking.status).toBe(201);
  });

  it("cannot reach a task in another account", async () => {
    // Both endpoints are checked, so a link cannot be used to learn whether
    // someone else's id exists.
    const bob = await signUp("bob@example.com", "Bob");
    const theirs = await addTodo(bob, await createProject(bob, "Bob's"), "他人の");

    const res = await link(alice, a.id, theirs.id);
    expect(res.status).toBe(404);
  });

  it("is removed by whoever owns both ends, and by nobody else", async () => {
    await link(alice, a.id, b.id);
    const [created] = await linksOf(alice, a.id);
    const bob = await signUp("bob@example.com", "Bob");

    const byOther = await app.request(
      `/api/links/${created!.id}`,
      { method: "DELETE", headers: bob },
      env,
    );
    expect(byOther.status).toBe(404);

    const byOwner = await app.request(
      `/api/links/${created!.id}`,
      { method: "DELETE", headers: alice },
      env,
    );
    expect(byOwner.status).toBe(204);
    expect(await linksOf(alice, a.id)).toEqual([]);
  });
});
