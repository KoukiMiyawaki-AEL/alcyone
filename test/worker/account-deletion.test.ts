import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import {
  addMemberByEmail,
  jsonHeaders,
  PASSWORD,
  resetAll,
  SEED_ADMIN_ID,
  signUp,
  signUpAdmin,
  uniqueIp,
  uniqueKey,
} from "./auth-helper";

async function createProject(headers: Headers, name: string): Promise<number> {
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

async function addTodo(headers: Headers, projectId: number, title: string): Promise<number> {
  const res = await app.request(
    `/api/projects/${projectId}/todos`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) },
    env,
  );
  return ((await res.json()) as { id: number }).id;
}

async function count(table: string): Promise<number> {
  // `resetAll` seeds one account so that no test's own user accidentally
  // becomes the administrator. It is not part of what these tests create, so
  // counting it would put every expectation here one too high.
  const skipSeed = table === "user" ? ` WHERE id <> '${SEED_ADMIN_ID}'` : "";
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}${skipSeed}`).first<{
    n: number;
  }>();
  return row?.n ?? 0;
}

async function deleteAccount(headers: Headers) {
  return app.request(
    "/api/auth/delete-user",
    // A fresh address: `/api/auth/*` is rate limited by IP, and every test in
    // this file deletes an account. Sharing one address makes the later ones
    // get a 429 — which leaves the account in place and reads as the purge
    // having failed to remove anything.
    {
      method: "POST",
      headers: jsonHeaders(headers, uniqueIp()),
      body: JSON.stringify({ password: PASSWORD }),
    },
    env,
  );
}

describe("account deletion", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
  });

  it("removes the user's projects and todos, including soft-deleted ones", async () => {
    const project = await createProject(alice, "Alice's project");
    const live = await addTodo(alice, project, "live");
    const trashed = await addTodo(alice, project, "trashed");

    // Soft-delete one, so the purge has to reach past `deletedAt IS NULL`.
    await app.request(`/api/todos/${trashed}`, { method: "DELETE", headers: alice }, env);
    expect(await count("todos")).toBe(2);

    const res = await deleteAccount(alice);
    expect(res.status).toBe(200);

    // "Delete my data" has to mean the rows are gone, not marked.
    expect(await count("todos")).toBe(0);
    expect(await count("projects")).toBe(0);
    expect(await count("user")).toBe(0);
    expect(live).toBeGreaterThan(0);
  });

  it("cascades Better Auth's own session and account rows", async () => {
    expect(await count("session")).toBe(1);
    expect(await count("account")).toBe(1);

    await deleteAccount(alice);

    expect(await count("session")).toBe(0);
    expect(await count("account")).toBe(0);
  });

  it("leaves other users untouched", async () => {
    // Bob's work has to live in somebody else's project: he cannot make one
    //, and if it were Alice's it would go with her by design.
    const bob = await signUpAdmin("bob@example.com", "Bob");
    const bobProject = await createProject(bob, "Bob's project");
    await addTodo(bob, bobProject, "bob's todo");
    await createProject(alice, "Alice's project");

    await deleteAccount(alice);

    expect(await count("user")).toBe(1);
    expect(await count("projects")).toBe(1);
    expect(await count("todos")).toBe(1);

    // And Bob can still use his account.
    const res = await app.request("/api/projects", { headers: bob }, env);
    expect(res.status).toBe(200);
  });

  it("accepts a fresh session in place of the password", async () => {
    // Better Auth's contract is "password OR a fresh session", and freshAge
    // defaults to 24h — so a just-signed-in user can delete without retyping.
    // Asserted rather than assumed, because it is a wider window than the UI's
    // password prompt implies.
    const res = await app.request(
      "/api/auth/delete-user",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({}) },
      env,
    );
    expect(res.status).toBe(200);
    expect(await count("user")).toBe(0);
  });

  it("refuses with the wrong password", async () => {
    const res = await app.request(
      "/api/auth/delete-user",
      {
        method: "POST",
        headers: jsonHeaders(alice),
        body: JSON.stringify({ password: "not the password" }),
      },
      env,
    );
    expect(res.status).not.toBe(200);
    expect(await count("user")).toBe(1);
  });
});

describe("an account that worked in somebody else's project", () => {
  let host: Headers;
  let guest: Headers;
  let projectId: number;
  let todoId: number;

  beforeEach(async () => {
    await resetAll();
    host = await signUpAdmin("host@example.com", "Host");
    guest = await signUp("guest@example.com", "Guest");

    projectId = await createProject(host, "Shared");
    await addMemberByEmail(host, projectId, "guest@example.com");

    const todo = await app.request(
      `/api/projects/${projectId}/todos`,
      {
        method: "POST",
        headers: jsonHeaders(host),
        body: JSON.stringify({ title: "shared task" }),
      },
      env,
    );
    todoId = ((await todo.json()) as { id: number }).id;
  });

  it("can still delete their account after commenting", async () => {
    // Every column that names `user.id` from outside this account's own
    // projects will refuse the delete if it is left behind — and the refusal
    // arrives as a 500, which reads as the server being broken rather than as
    // a row still pointing at them.
    await app.request(
      `/api/todos/${todoId}/comments`,
      {
        method: "POST",
        headers: jsonHeaders(guest),
        body: JSON.stringify({ body: "guest was here" }),
      },
      env,
    );

    const res = await deleteAccount(guest);

    expect(res.status).toBe(200);
    expect(await count("user")).toBe(1);
  });

  it("can still delete their account after changing a task", async () => {
    // Writes a `todo_events` row with this account as the actor.
    await app.request(
      `/api/todos/${todoId}`,
      { method: "PATCH", headers: jsonHeaders(guest), body: JSON.stringify({ status: "done" }) },
      env,
    );

    expect((await deleteAccount(guest)).status).toBe(200);
  });

  it("can still delete their account while holding an assignment", async () => {
    const id = await userIdOf(guest);
    await app.request(
      `/api/todos/${todoId}`,
      { method: "PATCH", headers: jsonHeaders(host), body: JSON.stringify({ assigneeId: id }) },
      env,
    );

    expect((await deleteAccount(guest)).status).toBe(200);

    // The task belongs to the project, not to them.
    const row = await env.DB.prepare("SELECT assigneeId FROM todos WHERE id = ?")
      .bind(todoId)
      .first<{ assigneeId: string | null }>();
    expect(row?.assigneeId).toBeNull();
  });

  it("leaves the project and its tasks behind", async () => {
    await app.request(
      `/api/todos/${todoId}/comments`,
      { method: "POST", headers: jsonHeaders(guest), body: JSON.stringify({ body: "theirs" }) },
      env,
    );

    expect((await deleteAccount(guest)).status).toBe(200);

    // Somebody else's project is not this account's to take with them.
    const res = await app.request(`/api/projects/${projectId}/todos`, { headers: host }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { todos: unknown[] }).todos).toHaveLength(1);
  });

  it("takes their own words with them", async () => {
    await app.request(
      `/api/todos/${todoId}/comments`,
      {
        method: "POST",
        headers: jsonHeaders(guest),
        body: JSON.stringify({ body: "guest was here" }),
      },
      env,
    );

    expect((await deleteAccount(guest)).status).toBe(200);

    const res = await app.request(`/api/todos/${todoId}/activity`, { headers: host }, env);
    const { comments } = (await res.json()) as { comments: unknown[] };
    expect(comments).toEqual([]);
  });

  it("does not revoke access it granted to somebody else", async () => {
    // Somebody they added to the project, then left. That person's access does
    // not stop being valid because the account that granted it is gone — only
    // "who let them in" is lost.
    const third = await signUp("third@example.com", "Third");
    await addMemberByEmail(host, projectId, "third@example.com");
    await env.DB.prepare("UPDATE project_members SET addedBy = ? WHERE userId = ?")
      .bind(await userIdOf(guest), await userIdOf(third))
      .run();

    expect((await deleteAccount(guest)).status).toBe(200);

    const res = await app.request(`/api/projects/${projectId}/todos`, { headers: third }, env);
    expect(res.status).toBe(200);
  });
});

async function userIdOf(headers: Headers): Promise<string> {
  const res = await app.request(
    "/api/auth/get-session",
    { headers: jsonHeaders(headers, uniqueIp()) },
    env,
  );
  const body = (await res.json()) as { user?: { id: string } } | null;
  if (!body?.user) throw new Error(`no session: ${res.status} ${JSON.stringify(body)}`);
  return body.user.id;
}
