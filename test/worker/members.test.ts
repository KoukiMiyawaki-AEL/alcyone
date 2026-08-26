import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Project } from "../../src/features/projects/types";
import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp, uniqueIp } from "./auth-helper";

async function userId(headers: Headers): Promise<string> {
  // A fresh address each time: `/api/auth/*` is rate limited by IP, and
  // `get-session` is one of those routes — reading the session repeatedly from
  // one address exhausts the window and answers 429, which reads exactly like
  // "not signed in".
  const res = await app.request(
    "/api/auth/get-session",
    { headers: jsonHeaders(headers, uniqueIp()) },
    env,
  );
  const body = (await res.json()) as { user?: { id: string } } | null;
  if (!body?.user) throw new Error(`no session: ${res.status} ${JSON.stringify(body)}`);
  return body.user.id;
}

async function makeAdmin(headers: Headers) {
  // No endpoint grants a role, deliberately — a role is not the user's to set.
  await env.DB.prepare("UPDATE user SET role = 'admin' WHERE id = ?")
    .bind(await userId(headers))
    .run();
}

async function createProject(headers: Headers, name = "P"): Promise<number> {
  const res = await app.request(
    "/api/projects",
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ name }) },
    env,
  );
  return ((await res.json()) as Project).id;
}

async function addTodo(headers: Headers, projectId: number, title = "T"): Promise<Todo> {
  const res = await app.request(
    `/api/projects/${projectId}/todos`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) },
    env,
  );
  return (await res.json()) as Todo;
}

async function addMember(headers: Headers, projectId: number, who: string) {
  return app.request(
    `/api/projects/${projectId}/members`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ userId: who }) },
    env,
  );
}

async function setRole(headers: Headers, target: string, role: string) {
  return app.request(
    `/api/users/${target}/role`,
    { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify({ role }) },
    env,
  );
}

async function roleOf(id: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT role FROM user WHERE id = ?")
    .bind(id)
    .first<{ role: string }>();
  return row?.role;
}

async function projectsOf(headers: Headers): Promise<string[]> {
  const res = await app.request("/api/projects", { headers }, env);
  return ((await res.json()) as { items: Project[] }).items.map((p) => p.name);
}

describe("membership", () => {
  let owner: Headers;
  let guest: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    owner = await signUp("owner@example.com", "Owner");
    guest = await signUp("guest@example.com", "Guest");
    projectId = await createProject(owner, "Shared work");
  });

  it("is invisible until someone is invited", async () => {
    expect(await projectsOf(guest)).toEqual([]);

    const res = await app.request(`/api/projects/${projectId}/todos`, { headers: guest }, env);
    expect(res.status).toBe(404);
  });

  it("lets an invited person read and change the tasks", async () => {
    await addMember(owner, projectId, await userId(guest));

    expect(await projectsOf(guest)).toEqual(["Shared work"]);

    const created = await addTodo(guest, projectId, "ゲストのタスク");
    expect(created.title).toBe("ゲストのタスク");

    const patched = await app.request(
      `/api/todos/${created.id}`,
      { method: "PATCH", headers: jsonHeaders(guest), body: JSON.stringify({ status: "done" }) },
      env,
    );
    expect(patched.status).toBe(200);
  });

  it("does not let a member hand out access", async () => {
    // The one power the owner/member distinction exists to withhold. A member
    // who could add members could give away the project.
    const third = await signUp("third@example.com", "Third");
    await addMember(owner, projectId, await userId(guest));

    const res = await addMember(guest, projectId, await userId(third));

    expect(res.status).toBe(404);
    expect(await projectsOf(third)).toEqual([]);
  });

  it("does not let a member delete the project", async () => {
    await addMember(owner, projectId, await userId(guest));

    const res = await app.request(
      `/api/projects/${projectId}`,
      { method: "DELETE", headers: guest },
      env,
    );

    expect(res.status).toBe(404);
    expect(await projectsOf(owner)).toEqual(["Shared work"]);
  });

  it("does not let a member issue a share link", async () => {
    await addMember(owner, projectId, await userId(guest));

    const res = await app.request(
      `/api/projects/${projectId}/share`,
      { method: "POST", headers: guest },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("takes access away again when the member is removed", async () => {
    const guestId = await userId(guest);
    await addMember(owner, projectId, guestId);
    expect(await projectsOf(guest)).toEqual(["Shared work"]);

    const res = await app.request(
      `/api/projects/${projectId}/members/${guestId}`,
      { method: "DELETE", headers: owner },
      env,
    );

    expect(res.status).toBe(204);
    expect(await projectsOf(guest)).toEqual([]);
  });

  it("refuses to store the owner as a member of their own project", async () => {
    // Their access comes from `projects.ownerId`. A row would be a second fact
    // that can disagree with the first.
    const res = await addMember(owner, projectId, await userId(owner));

    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT count(*) AS n FROM project_members").first<{
      n: number;
    }>();
    expect(row?.n).toBe(0);
  });

  it("refuses the same person twice", async () => {
    const guestId = await userId(guest);
    await addMember(owner, projectId, guestId);

    const again = await addMember(owner, projectId, guestId);
    expect(again.ok).toBe(false);
  });

  it("offers a member as an assignee", async () => {
    // The candidate list was a query rather than "it is you" from the start,
    // which is why it grows on its own now instead of needing to be found.
    await addMember(owner, projectId, await userId(guest));

    const res = await app.request(`/api/projects/${projectId}/assignees`, { headers: owner }, env);

    expect(((await res.json()) as { name: string }[]).map((a) => a.name).sort()).toEqual([
      "Guest",
      "Owner",
    ]);
  });

  it("names the members and says who may change the list", async () => {
    await addMember(owner, projectId, await userId(guest));

    const asOwner = await app.request(
      `/api/projects/${projectId}/members`,
      { headers: owner },
      env,
    );
    const asGuest = await app.request(
      `/api/projects/${projectId}/members`,
      { headers: guest },
      env,
    );

    expect((await asOwner.json()) as { canManage: boolean }).toMatchObject({ canManage: true });
    // Reported by the server rather than re-derived by the client, which is how
    // a UI ends up offering a button the API refuses.
    expect((await asGuest.json()) as { canManage: boolean }).toMatchObject({ canManage: false });
  });
});

describe("inviting by address", () => {
  let owner: Headers;
  let guest: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    owner = await signUp("owner@example.com", "Owner");
    guest = await signUp("guest@example.com", "Guest");
    projectId = await createProject(owner, "Shared work");
  });

  async function inviteByEmail(headers: Headers, email: string) {
    return app.request(
      `/api/projects/${projectId}/members`,
      {
        method: "POST",
        headers: jsonHeaders(headers, uniqueIp()),
        body: JSON.stringify({ email }),
      },
      env,
    );
  }

  it("lets an owner add someone without seeing the directory", async () => {
    // The gap this closes: the account list is an administrator's to see, which
    // left an ordinary owner with a member list and no way to add to it.
    const res = await inviteByEmail(owner, "guest@example.com");

    expect(res.status).toBe(201);
    expect(await projectsOf(guest)).toEqual(["Shared work"]);
  });

  it("matches an address regardless of case", async () => {
    const res = await inviteByEmail(owner, "GUEST@Example.com");

    expect(res.status).toBe(201);
    expect(await projectsOf(guest)).toEqual(["Shared work"]);
  });

  it("says not found for an address with no account", async () => {
    const res = await inviteByEmail(owner, "nobody@example.com");
    expect(res.status).toBe(404);
  });

  it("still refuses a member who tries it", async () => {
    // The permission is in the statement, so the address route is not a way
    // around it.
    const third = await signUp("third@example.com", "Third");
    await addMember(owner, projectId, await userId(guest));

    const res = await inviteByEmail(guest, "third@example.com");

    expect(res.status).toBe(404);
    expect(await projectsOf(third)).toEqual([]);
  });

  it("refuses the owner's own address", async () => {
    const res = await inviteByEmail(owner, "owner@example.com");
    expect(res.status).toBe(404);
  });
});

describe("administrators", () => {
  let owner: Headers;
  let admin: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    owner = await signUp("owner@example.com", "Owner");
    admin = await signUp("admin@example.com", "Admin");
    await makeAdmin(admin);
    projectId = await createProject(owner, "Someone else's");
  });

  it("can control who is on a project they do not own", async () => {
    const guest = await signUp("guest@example.com", "Guest");

    const res = await addMember(admin, projectId, await userId(guest));

    expect(res.status).toBe(201);
    expect(await projectsOf(guest)).toEqual(["Someone else's"]);
  });

  it("is the only role that can see the directory of accounts", async () => {
    const asAdmin = await app.request("/api/users", { headers: admin }, env);
    const asOwner = await app.request("/api/users", { headers: owner }, env);

    expect(((await asAdmin.json()) as unknown[]).length).toBeGreaterThan(1);
    // Handing every user a list of every other user is a directory, and nobody
    // asked for one.
    expect(await asOwner.json()).toEqual([]);
  });

  it("cannot be granted through the API", async () => {
    // Better Auth's update endpoint must never be a way to set this column.
    await app.request(
      "/api/auth/update-user",
      { method: "POST", headers: jsonHeaders(owner), body: JSON.stringify({ role: "admin" }) },
      env,
    );

    const row = await env.DB.prepare("SELECT role FROM user WHERE id = ?")
      .bind(await userId(owner))
      .first<{ role: string }>();
    expect(row?.role).toBe("member");
  });

  it("starts as a member once an administrator exists", async () => {
    const fresh = await signUp("fresh@example.com", "Fresh");

    const row = await env.DB.prepare("SELECT role FROM user WHERE id = ?")
      .bind(await userId(fresh))
      .first<{ role: string }>();
    expect(row?.role).toBe("member");
  });

  it("promotes and demotes through the role endpoint", async () => {
    const other = await signUp("other@example.com", "Other");
    const otherId = await userId(other);

    const up = await setRole(admin, otherId, "admin");
    expect(up.status).toBe(204);
    expect(await roleOf(otherId)).toBe("admin");

    const down = await setRole(admin, otherId, "member");
    expect(down.status).toBe(204);
    expect(await roleOf(otherId)).toBe("member");
  });

  it("refuses to remove the last administrator", async () => {
    // The role can only be granted by someone who holds it, so an installation
    // with none has no way back short of a database console. Reset without the
    // seed so that the account signed up here really is the only one.
    await resetAll({ seedAdmin: false });
    const only = await signUp("only@example.com", "Only");
    const onlyId = await userId(only);

    const res = await setRole(only, onlyId, "member");

    expect(res.status).toBe(404);
    expect(await roleOf(onlyId)).toBe("admin");
  });

  it("does not block demoting a member while only one administrator exists", async () => {
    // The guard is about losing the last administrator, not about the count on
    // its own — demoting someone who is already a member must not trip it. The
    // seed is dropped so the count really is one.
    await resetAll({ seedAdmin: false });
    const only = await signUp("only@example.com", "Only");
    const other = await signUp("other@example.com", "Other");
    const otherId = await userId(other);

    const res = await setRole(only, otherId, "member");

    expect(res.status).toBe(204);
    expect(await roleOf(otherId)).toBe("member");
  });

  it("lets the second-to-last administrator step down", async () => {
    const other = await signUp("other@example.com", "Other");
    const otherId = await userId(other);
    await setRole(admin, otherId, "admin");

    const res = await setRole(admin, await userId(admin), "member");

    expect(res.status).toBe(204);
    expect(await roleOf(otherId)).toBe("admin");
  });

  it("is not a role a member can hand themselves", async () => {
    const res = await setRole(owner, await userId(owner), "admin");

    expect(res.status).toBe(404);
    expect(await roleOf(await userId(owner))).toBe("member");
  });
});

describe("the first account", () => {
  it("becomes the administrator, because nobody else can grant it", async () => {
    await resetAll({ seedAdmin: false });

    const first = await signUp("first@example.com", "First");
    const second = await signUp("second@example.com", "Second");

    expect(await roleOf(await userId(first))).toBe("admin");
    expect(await roleOf(await userId(second))).toBe("member");
  });
});
