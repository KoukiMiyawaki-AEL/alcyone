import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { ProjectSummary } from "../../src/features/projects/types";
import type { AssignedTodo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp, signUpAdmin, uniqueKey } from "./auth-helper";

const today = new Date().toISOString().slice(0, 10);

function shiftDays(days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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

async function addTodo(
  headers: Headers,
  projectId: number,
  body: Record<string, unknown>,
): Promise<number> {
  const res = await app.request(
    `/api/projects/${projectId}/todos`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify(body) },
    env,
  );
  return ((await res.json()) as { id: number }).id;
}

async function summaries(headers: Headers): Promise<ProjectSummary[]> {
  const res = await app.request("/api/dashboard", { headers }, env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { projects: ProjectSummary[] }).projects;
}

async function userId(headers: Headers): Promise<string> {
  const res = await app.request("/api/auth/get-session", { headers }, env);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

describe("dashboard summaries", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
  });

  it("counts a project's tasks alongside its name", async () => {
    const project = await createProject(alice, "Counted");
    await addTodo(alice, project, { title: "one" });
    await addTodo(alice, project, { title: "two", status: "done" });
    await addTodo(alice, project, { title: "three", status: "done" });

    const [summary] = await summaries(alice);

    expect(summary).toMatchObject({ name: "Counted", total: 3, done: 2 });
  });

  it("includes a project that has no tasks at all", async () => {
    // The join carries `deletedAt IS NULL`; in the WHERE it would turn the
    // outer join into an inner one and drop exactly this project — the one a
    // dashboard most needs to show.
    await createProject(alice, "Empty");

    const [summary] = await summaries(alice);

    expect(summary).toMatchObject({ name: "Empty", total: 0, done: 0 });
  });

  it("separates overdue from due today, and counts neither as done", async () => {
    const project = await createProject(alice, "Dated");
    await addTodo(alice, project, { title: "late", dueAt: shiftDays(-1) });
    await addTodo(alice, project, { title: "now", dueAt: today });
    await addTodo(alice, project, { title: "later", dueAt: shiftDays(7) });
    // Finished and late is history, not an alarm.
    await addTodo(alice, project, { title: "was late", dueAt: shiftDays(-3), status: "done" });

    const [summary] = await summaries(alice);

    expect(summary).toMatchObject({ total: 4, done: 1, overdue: 1, dueToday: 1 });
  });

  it("does not count soft-deleted tasks", async () => {
    const project = await createProject(alice, "Trimmed");
    const doomed = await addTodo(alice, project, { title: "goes away" });
    await addTodo(alice, project, { title: "stays" });

    await app.request(`/api/todos/${doomed}`, { method: "DELETE", headers: alice }, env);

    const [summary] = await summaries(alice);
    expect(summary).toMatchObject({ total: 1 });
  });

  it("shows nothing of another account's projects", async () => {
    await createProject(alice, "Alice's");
    const bob = await signUp("bob@example.com", "Bob");

    expect(await summaries(bob)).toEqual([]);
  });
});

describe("assigned tasks", () => {
  let alice: Headers;
  let bob: Headers;
  let aliceId: string;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
    bob = await signUp("bob@example.com", "Bob");
    aliceId = await userId(alice);
  });

  async function assigned(headers: Headers): Promise<AssignedTodo[]> {
    const res = await app.request("/api/todos/assigned", { headers }, env);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: AssignedTodo[] }).items;
  }

  it("collects tasks from every project, with the project's name", async () => {
    const first = await createProject(alice, "First");
    const second = await createProject(alice, "Second");
    await addTodo(alice, first, { title: "here", assigneeId: aliceId });
    await addTodo(alice, second, { title: "there", assigneeId: aliceId });

    const items = await assigned(alice);

    expect(items.map((item) => [item.title, item.projectName])).toEqual([
      ["here", "First"],
      ["there", "Second"],
    ]);
  });

  it("leaves out what is finished and what is assigned to nobody", async () => {
    const project = await createProject(alice, "Mixed");
    await addTodo(alice, project, { title: "mine", assigneeId: aliceId });
    await addTodo(alice, project, { title: "mine but done", assigneeId: aliceId, status: "done" });
    await addTodo(alice, project, { title: "nobody's" });

    expect((await assigned(alice)).map((item) => item.title)).toEqual(["mine"]);
  });

  it("puts the undated last rather than first", async () => {
    // `dueAt IS NULL` sorts first in SQLite, and an undated task is the least
    // urgent thing on this page, not the most.
    const project = await createProject(alice, "Ordered");
    await addTodo(alice, project, { title: "someday", assigneeId: aliceId });
    await addTodo(alice, project, { title: "soon", assigneeId: aliceId, dueAt: shiftDays(2) });
    await addTodo(alice, project, { title: "now", assigneeId: aliceId, dueAt: today });

    expect((await assigned(alice)).map((item) => item.title)).toEqual(["now", "soon", "someday"]);
  });

  it("is another account's list, not this one's", async () => {
    const project = await createProject(alice, "Alice's");
    await addTodo(alice, project, { title: "alice's own", assigneeId: aliceId });

    expect(await assigned(bob)).toEqual([]);
  });
});
