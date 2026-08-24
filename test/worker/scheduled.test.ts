import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../../src/worker";
import { RETENTION_DAYS, purgeExpiredDeletions } from "../../src/worker/scheduled";
import { resetAll, signUp } from "./auth-helper";

const DAY = 24 * 60 * 60 * 1000;

/** Inserts a project directly so its `deletedAt` can be backdated. */
async function seedProject(ownerId: string, name: string, deletedAt: string | null) {
  const { meta } = await env.DB.prepare(
    "INSERT INTO projects (name, createdAt, ownerId, deletedAt) VALUES (?, ?, ?, ?)",
  )
    .bind(name, new Date().toISOString(), ownerId, deletedAt)
    .run();
  return meta.last_row_id;
}

async function seedTodo(projectId: number, title: string, deletedAt: string | null) {
  const stamp = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO todos (title, createdAt, updatedAt, projectId, deletedAt) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(title, stamp, stamp, projectId, deletedAt)
    .run();
}

async function names(table: "projects" | "todos"): Promise<string[]> {
  const column = table === "projects" ? "name" : "title";
  const { results } = await env.DB.prepare(`SELECT ${column} AS n FROM ${table} ORDER BY n`).all<{
    n: string;
  }>();
  return results.map((r) => r.n);
}

describe("scheduled purge", () => {
  let ownerId: string;

  beforeEach(async () => {
    await resetAll();
    await signUp("owner@example.com");
    const row = await env.DB.prepare("SELECT id FROM user LIMIT 1").first<{ id: string }>();
    ownerId = row!.id;
  });

  it("removes rows soft-deleted past the retention window", async () => {
    const expired = new Date(Date.now() - (RETENTION_DAYS + 1) * DAY).toISOString();
    const old = await seedProject(ownerId, "expired", expired);
    await seedTodo(old, "expired todo", expired);

    await purgeExpiredDeletions(env);

    expect(await names("projects")).toEqual([]);
    expect(await names("todos")).toEqual([]);
  });

  it("keeps live rows and recently deleted ones", async () => {
    const recent = new Date(Date.now() - 1 * DAY).toISOString();
    const live = await seedProject(ownerId, "live", null);
    const trashed = await seedProject(ownerId, "recently trashed", recent);
    await seedTodo(live, "live todo", null);
    await seedTodo(trashed, "recently trashed todo", recent);

    await purgeExpiredDeletions(env);

    // Undo has to keep working inside the window — that is the whole point of
    // choosing soft deletion.
    expect(await names("projects")).toEqual(["live", "recently trashed"]);
    expect(await names("todos")).toEqual(["live todo", "recently trashed todo"]);
  });

  it("reports what it removed", async () => {
    const expired = new Date(Date.now() - (RETENTION_DAYS + 1) * DAY).toISOString();
    const p = await seedProject(ownerId, "expired", expired);
    await seedTodo(p, "a", expired);
    await seedTodo(p, "b", expired);

    const result = await purgeExpiredDeletions(env);

    expect(result).toMatchObject({ projects: 1, todos: 2 });
  });

  it("counts rows, not writes the database happened to make", async () => {
    // Regression. This used to read `meta.changes`, which on D1 counts trigger
    // writes too — and inside a batch does not even attribute them to the
    // statement that caused them. Once `todos` gained the search-index triggers
    // (migration 0009), deleting 2 todos and 1 project reported 6 and 5. The
    // job still worked; only its report lied, which is the kind of bug that
    // survives for a long time.
    const expired = new Date(Date.now() - (RETENTION_DAYS + 1) * DAY).toISOString();
    const p = await seedProject(ownerId, "expired", expired);
    await seedTodo(p, "one", expired);
    await seedTodo(p, "two", expired);
    await seedTodo(p, "three", expired);

    const result = await purgeExpiredDeletions(env);

    expect(result).toMatchObject({ projects: 1, todos: 3 });
    expect(await names("todos")).toEqual([]);
  });

  it("runs from the Worker's scheduled handler", async () => {
    // Exercises the actual entry point, not just the function it calls — the
    // handler wiring is the part that would silently stop running.
    const expired = new Date(Date.now() - (RETENTION_DAYS + 1) * DAY).toISOString();
    await seedProject(ownerId, "expired", expired);

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await names("projects")).toEqual([]);
  });
});
