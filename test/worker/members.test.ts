import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Project } from "../../src/features/projects/types";
import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp, signUpAdmin, uniqueIp, uniqueKey } from "./auth-helper";

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
    {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ name, key: uniqueKey() }),
    },
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

async function removeMember(headers: Headers, projectId: number, who: string) {
  return app.request(
    `/api/projects/${projectId}/members/${who}`,
    { method: "DELETE", headers },
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
    owner = await signUpAdmin("owner@example.com", "Owner");
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

  it("takes the removed member's assignments with them", async () => {
    // A task assigned to somebody who can no longer open it is a task nobody is
    // doing, displayed as one that somebody is.
    const guestId = await userId(guest);
    await addMember(owner, projectId, guestId);

    const todo = (await addTodo(owner, projectId, "theirs")).id;
    await app.request(
      `/api/todos/${todo}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner),
        body: JSON.stringify({ assigneeId: guestId }),
      },
      env,
    );

    await removeMember(owner, projectId, guestId);

    const row = await env.DB.prepare("SELECT assigneeId FROM todos WHERE id = ?")
      .bind(todo)
      .first<{ assigneeId: string | null }>();
    expect(row?.assigneeId).toBeNull();
  });

  it("records the unassignment rather than performing it silently", async () => {
    const guestId = await userId(guest);
    await addMember(owner, projectId, guestId);
    const todo = (await addTodo(owner, projectId, "theirs")).id;
    await app.request(
      `/api/todos/${todo}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner),
        body: JSON.stringify({ assigneeId: guestId }),
      },
      env,
    );

    await removeMember(owner, projectId, guestId);

    const res = await app.request(`/api/todos/${todo}/activity`, { headers: owner }, env);
    const { events } = (await res.json()) as {
      events: { field: string; fromValue: string | null; toValue: string | null }[];
    };
    const last = events.at(-1);
    expect(last).toMatchObject({ field: "assigneeId", fromValue: guestId, toValue: null });
  });

  it("leaves other people's assignments alone", async () => {
    const guestId = await userId(guest);
    const ownerId = await userId(owner);
    await addMember(owner, projectId, guestId);

    const mine = (await addTodo(owner, projectId, "mine")).id;
    await app.request(
      `/api/todos/${mine}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner),
        body: JSON.stringify({ assigneeId: ownerId }),
      },
      env,
    );

    await removeMember(owner, projectId, guestId);

    const row = await env.DB.prepare("SELECT assigneeId FROM todos WHERE id = ?")
      .bind(mine)
      .first<{ assigneeId: string | null }>();
    expect(row?.assigneeId).toBe(ownerId);
  });

  it("takes the removed member's assignments with them", async () => {
    // A task assigned to somebody who can no longer open it is a task nobody is
    // doing, displayed as one that somebody is.
    const guestId = await userId(guest);
    await addMember(owner, projectId, guestId);

    const todo = (await addTodo(owner, projectId, "theirs")).id;
    await app.request(
      `/api/todos/${todo}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner),
        body: JSON.stringify({ assigneeId: guestId }),
      },
      env,
    );

    await removeMember(owner, projectId, guestId);

    const row = await env.DB.prepare("SELECT assigneeId FROM todos WHERE id = ?")
      .bind(todo)
      .first<{ assigneeId: string | null }>();
    expect(row?.assigneeId).toBeNull();
  });

  it("records the unassignment rather than performing it silently", async () => {
    const guestId = await userId(guest);
    await addMember(owner, projectId, guestId);
    const todo = (await addTodo(owner, projectId, "theirs")).id;
    await app.request(
      `/api/todos/${todo}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner),
        body: JSON.stringify({ assigneeId: guestId }),
      },
      env,
    );

    await removeMember(owner, projectId, guestId);

    const res = await app.request(`/api/todos/${todo}/activity`, { headers: owner }, env);
    const { events } = (await res.json()) as {
      events: { field: string; fromValue: string | null; toValue: string | null }[];
    };
    expect(events.at(-1)).toMatchObject({
      field: "assigneeId",
      fromValue: guestId,
      toValue: null,
    });
  });

  it("leaves everyone else's assignments alone", async () => {
    const guestId = await userId(guest);
    const ownerUserId = await userId(owner);
    await addMember(owner, projectId, guestId);

    const mine = (await addTodo(owner, projectId, "mine")).id;
    await app.request(
      `/api/todos/${mine}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner),
        body: JSON.stringify({ assigneeId: ownerUserId }),
      },
      env,
    );

    await removeMember(owner, projectId, guestId);

    const row = await env.DB.prepare("SELECT assigneeId FROM todos WHERE id = ?")
      .bind(mine)
      .first<{ assigneeId: string | null }>();
    expect(row?.assigneeId).toBe(ownerUserId);
  });

  it("writes nothing at all when the caller may not remove anyone", async () => {
    // Every statement in the batch carries the same check, so a refused caller
    // does not clear assignments and then fail to remove the row.
    const guestId = await userId(guest);
    await addMember(owner, projectId, guestId);
    const todo = (await addTodo(owner, projectId, "theirs")).id;
    await app.request(
      `/api/todos/${todo}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner),
        body: JSON.stringify({ assigneeId: guestId }),
      },
      env,
    );

    const res = await removeMember(guest, projectId, guestId);

    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT assigneeId FROM todos WHERE id = ?")
      .bind(todo)
      .first<{ assigneeId: string | null }>();
    expect(row?.assigneeId).toBe(guestId);
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
    owner = await signUpAdmin("owner@example.com", "Owner");
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
    owner = await signUpAdmin("owner@example.com", "Owner");
    admin = await signUp("admin@example.com", "Admin");
    await makeAdmin(admin);
    projectId = await createProject(owner, "Someone else's");
  });

  it("can open a project they are not on", async () => {
    // An administrator has to be able to find the project they were asked
    // about. Seeing is the wide scope here; changing it is the narrow one.
    const res = await app.request(`/api/projects/${projectId}/todos`, { headers: admin }, env);

    expect(res.status).toBe(200);
    expect(await projectsOf(admin)).toEqual(["Someone else's"]);
  });

  it("cannot change the settings of a project they are not on", async () => {
    // The role is not itself a way in. Somebody has to add them, and that
    // leaves a row saying who and when.
    const guest = await signUp("guest@example.com", "Guest");

    const res = await addMember(admin, projectId, await userId(guest));

    expect(res.status).toBe(404);
    expect(await projectsOf(guest)).toEqual([]);
  });

  it("says so, rather than offering a control the API refuses", async () => {
    const res = await app.request(`/api/projects/${projectId}/members`, { headers: admin }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ canManage: false });
  });

  it("administers the settings once they are on the project", async () => {
    await addMember(owner, projectId, await userId(admin));
    const guest = await signUp("guest@example.com", "Guest");

    const res = await addMember(admin, projectId, await userId(guest));

    expect(res.status).toBe(201);
    expect(await projectsOf(guest)).toEqual(["Someone else's"]);
  });

  it("cannot delete a project they are not on", async () => {
    const res = await app.request(
      `/api/projects/${projectId}`,
      { method: "DELETE", headers: admin },
      env,
    );

    expect(res.status).toBe(404);
    expect(await projectsOf(owner)).toEqual(["Someone else's"]);
  });

  it("is the only role that can see the directory of accounts", async () => {
    // Not `owner`: that account makes projects, so it is an administrator too
    //. The account that must see nothing has to be an ordinary one.
    const plain = await signUp("plain@example.com", "Plain");
    const asAdmin = await app.request("/api/users", { headers: admin }, env);
    const asOwner = await app.request("/api/users", { headers: plain }, env);

    expect(((await asAdmin.json()) as unknown[]).length).toBeGreaterThan(1);
    // Handing every user a list of every other user is a directory, and nobody
    // asked for one.
    expect(await asOwner.json()).toEqual([]);
  });

  it("cannot be granted through the API", async () => {
    // Better Auth's update endpoint must never be a way to set this column.
    const plain = await signUp("plain@example.com", "Plain");
    await app.request(
      "/api/auth/update-user",
      { method: "POST", headers: jsonHeaders(plain), body: JSON.stringify({ role: "admin" }) },
      env,
    );

    const row = await env.DB.prepare("SELECT role FROM user WHERE id = ?")
      .bind(await userId(plain))
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

  it("refuses to remove the last owner", async () => {
    // The role can only be granted by someone who holds it, so an installation
    // with none has no way back short of a database console. Reset without the
    // seed so that the account signed up here really is the only one.
    await resetAll({ seedAdmin: false });
    const only = await signUp("only@example.com", "Only");
    const onlyId = await userId(only);

    const res = await setRole(only, onlyId, "member");

    expect(res.status).toBe(404);
    expect(await roleOf(onlyId)).toBe("owner");
  });

  it("does not block demoting a member while only one owner exists", async () => {
    // The guard is about losing the last owner, not about the count on its own
    // — demoting someone who is already a member must not trip it. The seed is
    // dropped so the count really is one.
    await resetAll({ seedAdmin: false });
    const only = await signUp("only@example.com", "Only");
    const other = await signUp("other@example.com", "Other");
    const otherId = await userId(other);

    const res = await setRole(only, otherId, "member");

    expect(res.status).toBe(204);
    expect(await roleOf(otherId)).toBe("member");
  });

  it("lets the second-to-last owner step down", async () => {
    await resetAll({ seedAdmin: false });
    const first = await signUp("first@example.com", "First");
    const second = await signUp("second@example.com", "Second");
    const secondId = await userId(second);
    await setRole(first, secondId, "owner");

    const res = await setRole(first, await userId(first), "member");

    expect(res.status).toBe(204);
    expect(await roleOf(secondId)).toBe("owner");
  });

  it("is not a role a member can hand themselves", async () => {
    const plain = await signUp("plain@example.com", "Plain");

    const res = await setRole(plain, await userId(plain), "admin");

    expect(res.status).toBe(404);
    expect(await roleOf(await userId(plain))).toBe("member");
  });
});

describe("the first account", () => {
  it("becomes the owner, because nobody else can grant it", async () => {
    await resetAll({ seedAdmin: false });

    const first = await signUp("first@example.com", "First");
    const second = await signUp("second@example.com", "Second");

    expect(await roleOf(await userId(first))).toBe("owner");
    expect(await roleOf(await userId(second))).toBe("member");
  });
});

describe("creating accounts", () => {
  let owner: Headers;
  let admin: Headers;
  let plain: Headers;

  beforeEach(async () => {
    await resetAll({ seedAdmin: false });
    owner = await signUp("owner-of-all@example.com", "Owner");
    admin = await signUp("an-admin@example.com", "Admin");
    plain = await signUp("plain@example.com", "Plain");
    await setRole(owner, await userId(admin), "admin");
  });

  async function createAccount(headers: Headers, body: Record<string, unknown>) {
    return app.request(
      "/api/users",
      { method: "POST", headers: jsonHeaders(headers, uniqueIp()), body: JSON.stringify(body) },
      env,
    );
  }

  const account = (over: Record<string, unknown> = {}) => ({
    name: "New",
    email: `new-${Math.random().toString(36).slice(2)}@example.com`,
    password: "correct horse battery",
    role: "member",
    ...over,
  });

  it("makes an account with the role already on it", async () => {
    const body = account({ role: "admin" });
    const res = await createAccount(admin, body);

    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await roleOf(id)).toBe("admin");
  });

  it("leaves the caller signed in as themselves", async () => {
    // Better Auth's sign-up returns a session for the new account. Forwarding
    // those headers would swap the administrator for the person they created.
    const res = await createAccount(admin, account());

    // The D1 bookmark cookie is this API's own and rides on every response;
    // what must not be here is a session for the account just created.
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session_token");

    const still = await app.request("/api/auth/get-session", { headers: admin }, env);
    expect(((await still.json()) as { user: { email: string } }).user.email).toBe(
      "an-admin@example.com",
    );
  });

  it("lets the new account sign in with the password it was given", async () => {
    const body = account();
    await createAccount(admin, body);

    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: jsonHeaders(undefined, uniqueIp()),
        body: JSON.stringify({ email: body.email, password: body.password }),
      },
      env,
    );

    expect(res.status).toBe(200);
  });

  it("refuses an ordinary account entirely", async () => {
    const res = await createAccount(plain, account());
    expect(res.status).toBe(404);
  });

  it("refuses an administrator who tries to make an owner", async () => {
    // Checked before the account exists, so a refused role does not leave a
    // half-made account behind at the default one.
    const body = account({ role: "owner" });

    const res = await createAccount(admin, body);

    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
      .bind(body.email)
      .first();
    expect(row).toBeNull();
  });

  it("lets an owner make another owner", async () => {
    const res = await createAccount(owner, account({ role: "owner" }));

    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await roleOf(id)).toBe("owner");
  });

  it("rejects an address that already has an account", async () => {
    const body = account();
    expect((await createAccount(admin, body)).status).toBe(201);
    expect((await createAccount(admin, body)).status).toBe(400);
  });

  it("rejects a password shorter than the sign-up form's own floor", async () => {
    const res = await createAccount(admin, account({ password: "short" }));
    expect(res.status).toBe(400);
  });
});

describe("the rank between roles", () => {
  let owner: Headers;
  let admin: Headers;
  let plain: Headers;

  beforeEach(async () => {
    await resetAll({ seedAdmin: false });
    owner = await signUp("owner-of-all@example.com", "Owner");
    admin = await signUp("an-admin@example.com", "Admin");
    plain = await signUp("plain@example.com", "Plain");
    await setRole(owner, await userId(admin), "admin");
  });

  it("lets an administrator move accounts between member and admin", async () => {
    const plainId = await userId(plain);

    expect((await setRole(admin, plainId, "admin")).status).toBe(204);
    expect((await setRole(admin, plainId, "member")).status).toBe(204);
  });

  it("does not let an administrator appoint an owner", async () => {
    const plainId = await userId(plain);

    const res = await setRole(admin, plainId, "owner");

    expect(res.status).toBe(404);
    expect(await roleOf(plainId)).toBe("member");
  });

  it("does not let an administrator demote the owner who appointed them", async () => {
    const ownerId = await userId(owner);

    const res = await setRole(admin, ownerId, "member");

    expect(res.status).toBe(404);
    expect(await roleOf(ownerId)).toBe("owner");
  });

  it("lets an owner appoint and remove another owner", async () => {
    const plainId = await userId(plain);

    expect((await setRole(owner, plainId, "owner")).status).toBe(204);
    expect(await roleOf(plainId)).toBe("owner");

    expect((await setRole(owner, plainId, "member")).status).toBe(204);
    expect(await roleOf(plainId)).toBe("member");
  });
});
