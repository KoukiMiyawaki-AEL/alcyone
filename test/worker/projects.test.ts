import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Project } from "../../src/features/projects/types";
import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp, signUpAdmin, uniqueKey } from "./auth-helper";

let keyCounter = 0;

async function createProject(
  headers: Headers,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  keyCounter += 1;
  const res = await app.request(
    "/api/projects",
    {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ name, key: `K${keyCounter}`, ...extra }),
    },
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

async function userId(headers: Headers): Promise<string> {
  const res = await app.request("/api/auth/get-session", { headers }, env);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

describe("Projects API", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
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
    alice = await signUpAdmin("alice@example.com", "Alice");
    bob = await signUp("bob@example.com", "Bob");
    aliceProject = await createProject(alice, "Alice's project");
    aliceTodo = await addTodo(alice, aliceProject, "Alice's todo");
  });

  it("lists only the projects this account is on", async () => {
    // Bob cannot make one of his own any more, so his project is
    // one an administrator made and put him on. The boundary under test is the
    // same: what he is on, and nothing else.
    const bobsProject = await createProject(alice, "Bob's project");
    await app.request(
      `/api/projects/${bobsProject}/members`,
      {
        method: "POST",
        headers: jsonHeaders(alice),
        body: JSON.stringify({ email: "bob@example.com" }),
      },
      env,
    );

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

describe("project settings", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
  });

  async function create(body: Record<string, unknown>) {
    return app.request(
      "/api/projects",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify(body) },
      env,
    );
  }

  async function patch(id: number, body: Record<string, unknown>) {
    return app.request(
      `/api/projects/${id}`,
      { method: "PATCH", headers: jsonHeaders(alice), body: JSON.stringify(body) },
      env,
    );
  }

  async function read(id: number): Promise<Project> {
    const res = await app.request(`/api/projects/${id}/members`, { headers: alice }, env);
    return ((await res.json()) as { project: Project }).project;
  }

  it("keeps the settings it was created with", async () => {
    const res = await create({
      name: "Alcyone",
      key: "ALC",
      description: "the proving ground",
      color: "violet",
      startAt: "2026-09-01",
      dueAt: "2026-12-31",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      name: "Alcyone",
      key: "ALC",
      description: "the proving ground",
      color: "violet",
      startAt: "2026-09-01",
      dueAt: "2026-12-31",
      archivedAt: null,
    });
  });

  it("uppercases a key rather than refusing it", async () => {
    const res = await create({ name: "Lower", key: "low" });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ key: "LOW" });
  });

  it("refuses a key that is already taken", async () => {
    expect((await create({ name: "First", key: "DUP" })).status).toBe(201);
    expect((await create({ name: "Second", key: "DUP" })).status).toBe(400);
  });

  it("refuses a key with characters nobody can read out loud", async () => {
    expect((await create({ name: "Bad", key: "a b" })).status).toBe(400);
    expect((await create({ name: "Bad", key: "TOOMANYCHARS" })).status).toBe(400);
  });

  it("refuses a colour outside the palette", async () => {
    expect((await create({ name: "Bad", key: "BAD1", color: "chartreuse" })).status).toBe(400);
  });

  it("refuses a span that ends before it starts", async () => {
    const res = await create({
      name: "Backwards",
      key: "BACK",
      startAt: "2026-12-31",
      dueAt: "2026-01-01",
    });

    expect(res.status).toBe(400);
  });

  it("edits the settings, and leaves the key alone", async () => {
    const id = await createProject(alice, "Editable");
    const before = await read(id);

    const res = await patch(id, {
      name: "Renamed",
      description: "now with a note",
      color: "green",
    });

    expect(res.status).toBe(200);
    const after = await read(id);
    expect(after).toMatchObject({
      name: "Renamed",
      description: "now with a note",
      color: "green",
      // The key is in every reference anyone has written down, so there is no
      // path that changes it — not even one that ignores the field quietly.
      key: before.key,
    });
  });

  it("clears a field with null rather than leaving it alone", async () => {
    const id = await createProject(alice, "Datedish", { dueAt: "2026-10-01" });

    await patch(id, { dueAt: null });

    expect((await read(id)).dueAt).toBeNull();
  });

  it("refuses an edit that would put the span backwards", async () => {
    const id = await createProject(alice, "Spanned", { startAt: "2026-06-01" });

    const res = await patch(id, { dueAt: "2026-01-01" });

    expect(res.status).toBe(400);
    expect((await read(id)).dueAt).toBeNull();
  });

  it("archives and brings back, without deleting anything", async () => {
    const id = await createProject(alice, "Finished");

    expect((await patch(id, { archived: true })).status).toBe(200);
    expect((await read(id)).archivedAt).not.toBeNull();

    expect((await patch(id, { archived: false })).status).toBe(200);
    expect((await read(id)).archivedAt).toBeNull();
  });

  it("takes an archived project out of the list, and gives it its own", async () => {
    const kept = await createProject(alice, "Ongoing");
    const done = await createProject(alice, "Finished");
    await patch(done, { archived: true });

    const live = await app.request("/api/projects", { headers: alice }, env);
    expect(((await live.json()) as { items: Project[] }).items.map((p) => p.id)).toEqual([kept]);

    const dash = await app.request("/api/dashboard?archived=1", { headers: alice }, env);
    expect(((await dash.json()) as { projects: Project[] }).projects.map((p) => p.id)).toEqual([
      done,
    ]);
  });

  it("is not another account's to edit", async () => {
    const id = await createProject(alice, "Hers");
    const bob = await signUp("bob@example.com", "Bob");

    const res = await app.request(
      `/api/projects/${id}`,
      { method: "PATCH", headers: jsonHeaders(bob), body: JSON.stringify({ name: "Theirs" }) },
      env,
    );

    expect(res.status).toBe(404);
    expect((await read(id)).name).toBe("Hers");
  });
});

describe("who may create a project", () => {
  let admin: Headers;
  let member: Headers;

  beforeEach(async () => {
    await resetAll();
    admin = await signUpAdmin("admin@example.com", "Admin");
    member = await signUp("member@example.com", "Member");
  });

  async function create(headers: Headers, name: string) {
    return app.request(
      "/api/projects",
      {
        method: "POST",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ name, key: uniqueKey() }),
      },
      env,
    );
  }

  it("is an administrator's act, not part of doing the work", async () => {
    // Which projects exist is an operational decision. Letting
    // anyone create one made the role meaningless: a member could always have
    // a project they administered, without anybody granting them anything.
    const res = await create(member, "Not theirs to make");

    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT count(*) AS n FROM projects").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("an administrator makes one, and administers it", async () => {
    const res = await create(admin, "Theirs to make");
    expect(res.status).toBe(201);

    // Creating still confers management of what was created — that is a fact
    // about who made it, not a role.
    const { id } = (await res.json()) as { id: number };
    const members = await app.request(`/api/projects/${id}/members`, { headers: admin }, env);
    expect(await members.json()).toMatchObject({ canManage: true });
  });

  it("the system owner may too", async () => {
    // `resetAll` seeds the owner as a bare row, so this one signs up first on
    // an empty table and becomes the owner the way a real instance does.
    await resetAll({ seedAdmin: false });
    const owner = await signUp("first@example.com", "First");

    expect((await create(owner, "The owner's")).status).toBe(201);
  });

  it("keeps administering a project after losing the role", async () => {
    // "May create" and "responsible for what was created" are facts about
    // different moments. Demotion cannot reach back and undo the second.
    const created = await create(admin, "Made while an administrator");
    const { id } = (await created.json()) as { id: number };

    const adminId = await userId(admin);
    await env.DB.prepare("UPDATE user SET role = 'member' WHERE id = ?").bind(adminId).run();

    const members = await app.request(`/api/projects/${id}/members`, { headers: admin }, env);
    expect(await members.json()).toMatchObject({ canManage: true });

    // But they cannot make another one.
    expect((await create(admin, "Made after")).status).toBe(404);
  });

  it("puts no ceiling on how many", async () => {
    // The control is who, not how many: a cap answers a different fear, and
    // hitting one would be indistinguishable from being refused.
    for (let i = 0; i < 5; i += 1) {
      expect((await create(admin, `Project ${i}`)).status).toBe(201);
    }
  });
});
