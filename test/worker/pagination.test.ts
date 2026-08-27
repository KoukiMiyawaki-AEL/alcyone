import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp, uniqueKey } from "./auth-helper";

type Page = { todos: Todo[]; nextCursor: string | null };

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

async function addTodo(headers: Headers, projectId: number, title: string, details?: object) {
  const created = (await (
    await app.request(
      `/api/projects/${projectId}/todos`,
      { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) },
      env,
    )
  ).json()) as Todo;

  if (details) {
    await app.request(
      `/api/todos/${created.id}`,
      { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify(details) },
      env,
    );
  }
  return created;
}

async function page(headers: Headers, projectId: number, query: string): Promise<Page> {
  const res = await app.request(`/api/projects/${projectId}/todos${query}`, { headers }, env);
  return (await res.json()) as Page;
}

/** Walks every page and returns the titles in order, plus the page count. */
async function walk(headers: Headers, projectId: number, base: string) {
  const titles: string[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const result: Page = await page(headers, projectId, `${base}${suffix}`);
    titles.push(...result.todos.map((t) => t.title));
    cursor = result.nextCursor;
    pages += 1;
    if (pages > 20) throw new Error("pagination did not terminate");
  } while (cursor);

  return { titles, pages };
}

describe("pagination", () => {
  let headers: Headers;
  let projectId: number;

  beforeEach(async () => {
    await resetAll();
    headers = await signUp("owner@example.com");
    projectId = await createProject(headers);
  });

  it("returns everything exactly once across pages", async () => {
    for (let i = 1; i <= 7; i += 1) await addTodo(headers, projectId, `todo ${i}`);

    const { titles, pages } = await walk(headers, projectId, "?limit=3");

    expect(pages).toBe(3);
    expect(titles).toEqual(["todo 1", "todo 2", "todo 3", "todo 4", "todo 5", "todo 6", "todo 7"]);
  });

  it("does not repeat or skip rows that share a sort value", async () => {
    // The case a cursor holding only the sort value would get wrong: the page
    // boundary lands in the middle of a group with identical priorities.
    for (let i = 1; i <= 6; i += 1) {
      await addTodo(headers, projectId, `same ${i}`, { priority: 2 });
    }

    const { titles } = await walk(headers, projectId, "?sort=priority&limit=2");

    expect(titles).toEqual(["same 1", "same 2", "same 3", "same 4", "same 5", "same 6"]);
    expect(new Set(titles).size).toBe(6);
  });

  it("paginates due-date order with undated todos last", async () => {
    await addTodo(headers, projectId, "undated a");
    await addTodo(headers, projectId, "soon", { dueAt: "2026-01-01" });
    await addTodo(headers, projectId, "undated b");
    await addTodo(headers, projectId, "later", { dueAt: "2026-12-31" });

    const { titles } = await walk(headers, projectId, "?sort=due&limit=1");

    expect(titles).toEqual(["soon", "later", "undated a", "undated b"]);
  });

  it("stops with a null cursor on the last page", async () => {
    await addTodo(headers, projectId, "only");

    const result = await page(headers, projectId, "?limit=10");

    expect(result.todos).toHaveLength(1);
    // No trailing empty request: the extra fetched row is what tells us.
    expect(result.nextCursor).toBeNull();
  });

  it("combines a filter with paging", async () => {
    for (let i = 1; i <= 4; i += 1) {
      const todo = await addTodo(headers, projectId, `todo ${i}`);
      if (i % 2 === 0) {
        await app.request(
          `/api/todos/${todo.id}`,
          {
            method: "PATCH",
            headers: jsonHeaders(headers),
            body: JSON.stringify({ status: "done" }),
          },
          env,
        );
      }
    }

    const { titles } = await walk(headers, projectId, "?status=active&limit=1");
    expect(titles).toEqual(["todo 1", "todo 3"]);
  });

  it("treats a nonsense cursor as the beginning rather than an error", async () => {
    await addTodo(headers, projectId, "first");

    const result = await page(headers, projectId, "?cursor=not-a-real-cursor");

    // A cursor is a position, not an instruction — a stale one should not fail
    // the request.
    expect(result.todos.map((t) => t.title)).toEqual(["first"]);
  });

  it("rejects a limit outside the allowed range", async () => {
    for (const query of ["?limit=0", "?limit=101", "?limit=abc"]) {
      const res = await app.request(`/api/projects/${projectId}/todos${query}`, { headers }, env);
      expect(res.status, query).toBe(400);
    }
  });

  it("paginates the project list too", async () => {
    for (let i = 2; i <= 5; i += 1) await createProject(headers, `Project ${i}`);

    const first = (await (await app.request("/api/projects?limit=2", { headers }, env)).json()) as {
      items: { name: string }[];
      nextCursor: string | null;
    };

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
  });
});
