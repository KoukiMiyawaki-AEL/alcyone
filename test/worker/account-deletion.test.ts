import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { jsonHeaders, PASSWORD, resetAll, SEED_ADMIN_ID, signUp, uniqueKey } from "./auth-helper";

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
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ password: PASSWORD }) },
    env,
  );
}

describe("account deletion", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
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
    const bob = await signUp("bob@example.com", "Bob");
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
    // password prompt implies. See ADR 0015.
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
