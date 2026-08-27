import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp, uniqueKey } from "./auth-helper";

type Label = { id: number; name: string; color: string; projectId: number };

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

async function addLabel(
  headers: Headers,
  projectId: number,
  name: string,
  color = "blue",
): Promise<Response> {
  return app.request(
    `/api/projects/${projectId}/labels`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ name, color }) },
    env,
  );
}

async function labelId(headers: Headers, projectId: number, name: string): Promise<number> {
  const res = await addLabel(headers, projectId, name);
  return ((await res.json()) as { id: number }).id;
}

async function setLabels(headers: Headers, todoId: number, labelIds: number[]) {
  return app.request(
    `/api/todos/${todoId}/labels`,
    { method: "PUT", headers: jsonHeaders(headers), body: JSON.stringify({ labelIds }) },
    env,
  );
}

async function listTodos(headers: Headers, projectId: number, query = "") {
  const res = await app.request(`/api/projects/${projectId}/todos${query}`, { headers }, env);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    todos: { id: number; title: string; labels: Label[] }[];
    labels: Label[];
  };
}

describe("labels", () => {
  let alice: Headers;
  let project: number;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    project = await createProject(alice, "Labelled");
  });

  it("belongs to a project and comes back with its list", async () => {
    await addLabel(alice, project, "bug", "red");
    await addLabel(alice, project, "chore");

    const { labels } = await listTodos(alice, project);

    expect(labels.map((l) => [l.name, l.color])).toEqual([
      ["bug", "red"],
      ["chore", "blue"],
    ]);
  });

  it("refuses a second label with the same name in one project", async () => {
    expect((await addLabel(alice, project, "bug")).status).toBe(201);
    expect((await addLabel(alice, project, "bug")).status).toBe(400);
  });

  it("allows the same name in a different project", async () => {
    const other = await createProject(alice, "Other");
    await addLabel(alice, project, "bug");

    expect((await addLabel(alice, other, "bug")).status).toBe(201);
  });

  it("refuses a colour outside the palette", async () => {
    const res = await addLabel(alice, project, "bug", "chartreuse");
    expect(res.status).toBe(400);
  });

  it("puts a set on a task, and replaces it wholesale", async () => {
    const todo = await addTodo(alice, project, "labelled");
    const bug = await labelId(alice, project, "bug");
    const chore = await labelId(alice, project, "chore");

    const first = await setLabels(alice, todo, [bug, chore]);
    expect(((await first.json()) as { labels: Label[] }).labels.map((l) => l.name)).toEqual([
      "bug",
      "chore",
    ]);

    // The client sends what the task should end up with, not a diff.
    const second = await setLabels(alice, todo, [chore]);
    expect(((await second.json()) as { labels: Label[] }).labels.map((l) => l.name)).toEqual([
      "chore",
    ]);
  });

  it("ignores the same label sent twice", async () => {
    const todo = await addTodo(alice, project, "labelled");
    const bug = await labelId(alice, project, "bug");

    const res = await setLabels(alice, todo, [bug, bug]);

    expect(((await res.json()) as { labels: Label[] }).labels).toHaveLength(1);
  });

  it("will not put another project's label on a task", async () => {
    // A foreign key checks that the row exists, not that it belongs here.
    const other = await createProject(alice, "Other");
    const foreign = await labelId(alice, other, "elsewhere");
    const todo = await addTodo(alice, project, "labelled");

    const res = await setLabels(alice, todo, [foreign]);

    expect(((await res.json()) as { labels: Label[] }).labels).toEqual([]);
  });

  it("narrows the list to one label, in SQL", async () => {
    const bug = await labelId(alice, project, "bug");
    const tagged = await addTodo(alice, project, "has the label");
    await addTodo(alice, project, "does not");
    await setLabels(alice, tagged, [bug]);

    const { todos } = await listTodos(alice, project, `?label=${bug}`);

    expect(todos.map((t) => t.title)).toEqual(["has the label"]);
  });

  it("ignores a label parameter that is not a number at all", async () => {
    // Typed into the URL by hand. `.catch()` drops it rather than answering
    // with an error page for a filter nobody meant to set.
    await addTodo(alice, project, "one");

    expect((await listTodos(alice, project, "?label=nonsense")).todos).toHaveLength(1);
  });

  it("applies a label id that is a number but matches nothing", async () => {
    // Not the same case. This one is a filter the caller really did ask for,
    // and answering with the unfiltered list would quietly show rows that do
    // not match what the screen says it is showing.
    await addTodo(alice, project, "one");

    expect((await listTodos(alice, project, "?label=999999")).todos).toEqual([]);
  });

  it("carries each task's labels with the list, not one request per row", async () => {
    const bug = await labelId(alice, project, "bug");
    const first = await addTodo(alice, project, "first");
    await addTodo(alice, project, "second");
    await setLabels(alice, first, [bug]);

    const { todos } = await listTodos(alice, project);

    expect(todos.find((t) => t.title === "first")?.labels.map((l) => l.name)).toEqual(["bug"]);
    expect(todos.find((t) => t.title === "second")?.labels).toEqual([]);
  });

  it("detaches a label from every task when it is deleted", async () => {
    const bug = await labelId(alice, project, "bug");
    const todo = await addTodo(alice, project, "labelled");
    await setLabels(alice, todo, [bug]);

    const res = await app.request(`/api/labels/${bug}`, { method: "DELETE", headers: alice }, env);
    expect(res.status).toBe(204);

    const { todos, labels } = await listTodos(alice, project);
    expect(labels).toEqual([]);
    expect(todos[0]?.labels).toEqual([]);
  });

  it("renames and recolours a label", async () => {
    const bug = await labelId(alice, project, "bug");

    const res = await app.request(
      `/api/labels/${bug}`,
      { method: "PATCH", headers: jsonHeaders(alice), body: JSON.stringify({ name: "defect" }) },
      env,
    );

    expect(res.status).toBe(204);
    expect((await listTodos(alice, project)).labels.map((l) => l.name)).toEqual(["defect"]);
  });
});

describe("labels across accounts", () => {
  let alice: Headers;
  let bob: Headers;
  let aliceProject: number;
  let aliceLabel: number;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    bob = await signUp("bob@example.com", "Bob");
    aliceProject = await createProject(alice, "Alice's");
    aliceLabel = await labelId(alice, aliceProject, "private");
  });

  it("cannot be created in a project the caller cannot reach", async () => {
    const res = await addLabel(bob, aliceProject, "intruder");
    expect(res.status).toBe(404);
  });

  it("cannot be renamed by someone else", async () => {
    const res = await app.request(
      `/api/labels/${aliceLabel}`,
      { method: "PATCH", headers: jsonHeaders(bob), body: JSON.stringify({ name: "theirs" }) },
      env,
    );

    expect(res.status).toBe(404);
    expect((await listTodos(alice, aliceProject)).labels.map((l) => l.name)).toEqual(["private"]);
  });

  it("cannot be deleted by someone else", async () => {
    const res = await app.request(
      `/api/labels/${aliceLabel}`,
      { method: "DELETE", headers: bob },
      env,
    );

    expect(res.status).toBe(404);
    expect((await listTodos(alice, aliceProject)).labels).toHaveLength(1);
  });

  it("cannot be attached to someone else's task", async () => {
    const aliceTodo = await addTodo(alice, aliceProject, "hers");

    const res = await setLabels(bob, aliceTodo, [aliceLabel]);

    expect(res.status).toBe(404);
    expect((await listTodos(alice, aliceProject)).todos[0]?.labels).toEqual([]);
  });
});
