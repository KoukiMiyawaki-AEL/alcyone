import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp } from "./auth-helper";

async function createProject(headers: Headers, name = "Project"): Promise<number> {
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

async function search(headers: Headers, q: string): Promise<string[]> {
  const res = await app.request(`/api/search?q=${encodeURIComponent(q)}`, { headers }, env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Todo[] }).items.map((t) => t.title);
}

describe("search", () => {
  let alice: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    projectId = await createProject(alice);
  });

  it("finds a todo by a word in its title", async () => {
    await addTodo(alice, projectId, "write the design document");
    await addTodo(alice, projectId, "deploy to production");

    expect(await search(alice, "design")).toEqual(["write the design document"]);
  });

  it("matches inside a word, not only at its start", async () => {
    // Trigram indexes every three-character run, so this works where a
    // word-based tokenizer would need a prefix.
    await addTodo(alice, projectId, "review pagination");

    expect(await search(alice, "aginat")).toEqual(["review pagination"]);
  });

  it("finds Japanese text with no spaces in it", async () => {
    // The reason for the trigram tokenizer. With the default unicode61 this
    // returns nothing, because the whole phrase is a single token.
    await addTodo(alice, projectId, "設計ドキュメントを書く");
    await addTodo(alice, projectId, "本番環境へデプロイ");

    expect(await search(alice, "ドキュメント")).toEqual(["設計ドキュメントを書く"]);
  });

  it("falls back to a scan for queries too short to be trigrams", async () => {
    // Two characters cannot match a trigram at all, and two-character queries
    // are ordinary in Japanese, so short input must not silently find nothing.
    await addTodo(alice, projectId, "設計ドキュメントを書く");

    expect(await search(alice, "設計")).toEqual(["設計ドキュメントを書く"]);
  });

  it("requires every term to appear", async () => {
    await addTodo(alice, projectId, "write the design document");
    await addTodo(alice, projectId, "design review");

    expect(await search(alice, "design document")).toEqual(["write the design document"]);
  });

  it("treats FTS5 syntax as text rather than as a query", async () => {
    // A quote, a wildcard and a boolean operator are all FTS5 syntax. Passing
    // them through unquoted turns a search into a syntax error, which the user
    // sees as the search box being broken.
    await addTodo(alice, projectId, 'the "quoted" one');

    expect(await search(alice, '"quoted"')).toEqual(['the "quoted" one']);
    expect(await search(alice, "AND OR NOT")).toEqual([]);
    expect(await search(alice, "((( ")).toEqual([]);
  });

  it("treats LIKE wildcards in a short query as text", async () => {
    // The short-query path builds a LIKE pattern, where % would otherwise mean
    // "anything" and match every row.
    await addTodo(alice, projectId, "fifty percent");

    expect(await search(alice, "%")).toEqual([]);
  });

  it("rejects an empty query instead of returning the whole table", async () => {
    await addTodo(alice, projectId, "anything");

    const res = await app.request("/api/search?q=%20%20", { headers: alice }, env);
    expect(res.status).toBe(400);
  });

  it("does not find another user's todos", async () => {
    // The index holds every user's titles — it has no owner column — so this
    // fails the moment the ownership join is dropped.
    const bob = await signUp("bob@example.com", "Bob");
    const bobProject = await createProject(bob, "Bob's");
    await addTodo(bob, bobProject, "bob's secret plan");
    await addTodo(alice, projectId, "alice's own plan");

    expect(await search(alice, "plan")).toEqual(["alice's own plan"]);
    expect(await search(bob, "plan")).toEqual(["bob's secret plan"]);
  });

  it("does not find soft-deleted todos, and finds them again after a restore", async () => {
    const todo = await addTodo(alice, projectId, "temporarily gone");

    await app.request(`/api/todos/${todo.id}`, { method: "DELETE", headers: alice }, env);
    expect(await search(alice, "temporarily")).toEqual([]);

    await app.request(`/api/todos/${todo.id}/restore`, { method: "POST", headers: alice }, env);
    expect(await search(alice, "temporarily")).toEqual(["temporarily gone"]);
  });

  it("searches across every project the user owns", async () => {
    const other = await createProject(alice, "Other");
    await addTodo(alice, projectId, "shared keyword here");
    await addTodo(alice, other, "shared keyword too");

    expect((await search(alice, "keyword")).sort()).toEqual([
      "shared keyword here",
      "shared keyword too",
    ]);
  });

  it("pages through matches without repeating or skipping one", async () => {
    // Trigram scores tie constantly, so the id tiebreak carries most of the
    // ordering here — which is exactly the case that breaks without it.
    for (let i = 0; i < 7; i++) await addTodo(alice, projectId, `repeated keyword ${i}`);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const url: string = `/api/search?q=keyword&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await app.request(url, { headers: alice }, env);
      const body = (await res.json()) as { items: Todo[]; nextCursor: string | null };
      seen.push(...body.items.map((t) => t.title));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(7);
  });
});

describe("the search index tracks its table", () => {
  let alice: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    projectId = await createProject(alice);
  });

  it("indexes a todo created after the index existed", async () => {
    await addTodo(alice, projectId, "brand new title");
    expect(await search(alice, "brand")).toEqual(["brand new title"]);
  });

  it("stops matching the old title after a rename", async () => {
    // Written against SQL rather than the API on purpose: no endpoint renames a
    // todo yet, so the update trigger has no caller that changes the title. The
    // claim under test belongs to the migration, and this is where it lives.
    // The trigger has to remove the old terms explicitly — without the 'delete'
    // half, the row keeps matching its previous title forever.
    const todo = await addTodo(alice, projectId, "original wording");
    await env.DB.prepare("UPDATE todos SET title = ? WHERE id = ?")
      .bind("replacement wording", todo.id)
      .run();

    expect(await search(alice, "original")).toEqual([]);
    expect(await search(alice, "replacement")).toEqual(["replacement wording"]);
  });

  it("survives an update that does not touch the title", async () => {
    // Changing the status fires the same trigger, which deletes and reinserts
    // the index entry. If either half were wrong, ordinary use would quietly
    // erode the index.
    const todo = await addTodo(alice, projectId, "still findable");

    await app.request(
      `/api/todos/${todo.id}`,
      {
        method: "PATCH",
        headers: jsonHeaders(alice),
        body: JSON.stringify({ status: "done" }),
      },
      env,
    );

    expect(await search(alice, "findable")).toEqual(["still findable"]);
  });

  it("drops a hard-deleted todo out of the index", async () => {
    // Account deletion hard-deletes, so the delete trigger is not theoretical.
    await addTodo(alice, projectId, "hard deleted title");
    await env.DB.prepare("DELETE FROM todos WHERE title = ?").bind("hard deleted title").run();

    const row = await env.DB.prepare("SELECT count(*) AS n FROM todos_fts WHERE todos_fts MATCH ?")
      .bind('"hard deleted"')
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
