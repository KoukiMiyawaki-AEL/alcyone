import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Todo } from "../../src/features/todos/types";
import { app } from "../../src/worker";
import { jsonHeaders, resetAll, signUp } from "./auth-helper";

type Comment = {
  id: number;
  body: string;
  authorId: string;
  updatedAt: string;
  revisionId: string | null;
};
type Event = {
  field: string;
  fromValue: string | null;
  toValue: string | null;
  actorId: string;
  revisionId: string;
};

async function createProject(headers: Headers, name = "P"): Promise<number> {
  const res = await app.request(
    "/api/projects",
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ name }) },
    env,
  );
  return ((await res.json()) as { id: number }).id;
}

async function addTodo(headers: Headers, projectId: number, title = "T"): Promise<Todo> {
  const res = await app.request(
    `/api/projects/${projectId}/todos`,
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title }) },
    env,
  );
  return (await res.json()) as Todo;
}

async function patch(headers: Headers, id: number, body: unknown) {
  return app.request(
    `/api/todos/${id}`,
    { method: "PATCH", headers: jsonHeaders(headers), body: JSON.stringify(body) },
    env,
  );
}

async function activity(headers: Headers, todoId: number) {
  const res = await app.request(`/api/todos/${todoId}/activity`, { headers }, env);
  return {
    status: res.status,
    ...((await res.json()) as { comments: Comment[]; events: Event[] }),
  };
}

describe("comments", () => {
  let alice: Headers;
  let todo: Todo;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    todo = await addTodo(alice, await createProject(alice));
  });

  async function comment(body: string) {
    const res = await app.request(
      `/api/todos/${todo.id}/comments`,
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ body }) },
      env,
    );
    return { status: res.status, comment: (await res.json()) as Comment };
  }

  it("records who wrote it", async () => {
    // Today the author is always the owner. Storing it anyway is what makes
    // these comments survive the day that stops being true.
    const { status, comment: created } = await comment("先に設計を確認する");

    expect(status).toBe(201);
    expect(created.body).toBe("先に設計を確認する");
    expect(created.authorId).toBeTruthy();
  });

  it("lists comments oldest first", async () => {
    await comment("ひとつめ");
    await comment("ふたつめ");

    const { comments } = await activity(alice, todo.id);
    expect(comments.map((c) => c.body)).toEqual(["ひとつめ", "ふたつめ"]);
  });

  it("rejects an empty comment", async () => {
    const res = await app.request(
      `/api/todos/${todo.id}/comments`,
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ body: "   " }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("can be edited, and says it was", async () => {
    const { comment: created } = await comment("まちがい");

    const res = await app.request(
      `/api/comments/${created.id}`,
      { method: "PATCH", headers: jsonHeaders(alice), body: JSON.stringify({ body: "なおした" }) },
      env,
    );
    const updated = (await res.json()) as Comment;

    expect(updated.body).toBe("なおした");
    // The edit is visible: a comment silently rewritten is a different kind of
    // record from one that shows it changed.
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
  });

  it("disappears when deleted, without taking the row with it", async () => {
    const { comment: created } = await comment("取り消す");

    const res = await app.request(
      `/api/comments/${created.id}`,
      { method: "DELETE", headers: alice },
      env,
    );
    expect(res.status).toBe(204);

    expect((await activity(alice, todo.id)).comments).toEqual([]);

    // Soft delete, like every other user-facing row (ADR 0015).
    const row = await env.DB.prepare("SELECT deletedAt FROM todo_comments WHERE id = ?")
      .bind(created.id)
      .first<{ deletedAt: string | null }>();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("cannot be written on someone else's todo", async () => {
    // The ownership check is inside the INSERT, so an id that is not yours
    // writes nothing and answers exactly as an id that never existed does.
    const bob = await signUp("bob@example.com", "Bob");

    const res = await app.request(
      `/api/todos/${todo.id}/comments`,
      { method: "POST", headers: jsonHeaders(bob), body: JSON.stringify({ body: "侵入" }) },
      env,
    );

    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT count(*) AS n FROM todo_comments").first<{
      n: number;
    }>();
    expect(row?.n).toBe(0);
  });

  it("cannot be edited or deleted by another user", async () => {
    const { comment: created } = await comment("わたしのもの");
    const bob = await signUp("bob@example.com", "Bob");

    const edit = await app.request(
      `/api/comments/${created.id}`,
      { method: "PATCH", headers: jsonHeaders(bob), body: JSON.stringify({ body: "書き換え" }) },
      env,
    );
    const remove = await app.request(
      `/api/comments/${created.id}`,
      { method: "DELETE", headers: bob },
      env,
    );

    expect([edit.status, remove.status]).toEqual([404, 404]);
    expect((await activity(alice, todo.id)).comments[0]?.body).toBe("わたしのもの");
  });

  it("is not readable through another user's activity request", async () => {
    await comment("見せない");
    const bob = await signUp("bob@example.com", "Bob");

    const res = await app.request(`/api/todos/${todo.id}/activity`, { headers: bob }, env);
    expect(res.status).toBe(404);
  });
});

describe("change history", () => {
  let alice: Headers;
  let todo: Todo;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
    todo = await addTodo(alice, await createProject(alice), "履歴のあるタスク");
  });

  it("opens with the task being created", async () => {
    const { events } = await activity(alice, todo.id);
    expect(events.map((e) => e.field)).toEqual(["created"]);
  });

  it("records a status change with both values", async () => {
    // Both ends, because "it became blocked" without saying from what is half
    // the story when the question is why the schedule slipped.
    await patch(alice, todo.id, { status: "in_progress" });

    const { events } = await activity(alice, todo.id);
    expect(events.at(-1)).toMatchObject({
      field: "status",
      fromValue: "todo",
      toValue: "in_progress",
    });
  });

  it("records dates being set and cleared", async () => {
    await patch(alice, todo.id, { dueAt: "2026-12-01" });
    await patch(alice, todo.id, { dueAt: null });

    const { events } = await activity(alice, todo.id);
    const dates = events.filter((e) => e.field === "dueAt");

    // A cleared date has to be recorded too. SQL's `<>` is null-propagating,
    // so a naive comparison would silently drop exactly these two rows.
    expect(dates).toMatchObject([
      { fromValue: null, toValue: "2026-12-01" },
      { fromValue: "2026-12-01", toValue: null },
    ]);
  });

  it("writes nothing for a field that did not change", async () => {
    // The detail form submits every field on every save. Recording what was
    // asked for rather than what changed would bury one real change under five
    // non-changes.
    await patch(alice, todo.id, {
      title: "履歴のあるタスク",
      status: "todo",
      priority: 0,
      dueAt: null,
      startAt: null,
    });

    const { events } = await activity(alice, todo.id);
    expect(events.map((e) => e.field)).toEqual(["created"]);
  });

  it("records one row per field when several change at once", async () => {
    await patch(alice, todo.id, { status: "in_progress", priority: 2, title: "改名" });

    const { events } = await activity(alice, todo.id);
    expect(events.map((e) => e.field).sort()).toEqual(["created", "priority", "status", "title"]);
  });

  it("does not record a description edit", async () => {
    // Prose changes are noise in a change log; the note itself is the record.
    await patch(alice, todo.id, { description: "長い説明" });

    const { events } = await activity(alice, todo.id);
    expect(events.map((e) => e.field)).toEqual(["created"]);
  });

  it("records deletion and restoration", async () => {
    await app.request(`/api/todos/${todo.id}`, { method: "DELETE", headers: alice }, env);
    await app.request(`/api/todos/${todo.id}/restore`, { method: "POST", headers: alice }, env);

    const { events } = await activity(alice, todo.id);
    expect(events.map((e) => e.field)).toEqual(["created", "deleted", "restored"]);
  });

  it("survives the todo being deleted, which is when it is worth reading", async () => {
    await patch(alice, todo.id, { status: "blocked" });
    await app.request(`/api/todos/${todo.id}`, { method: "DELETE", headers: alice }, env);
    await app.request(`/api/todos/${todo.id}/restore`, { method: "POST", headers: alice }, env);

    const { events } = await activity(alice, todo.id);
    expect(events.some((e) => e.field === "status" && e.toValue === "blocked")).toBe(true);
  });

  it("names the actor on every row", async () => {
    await patch(alice, todo.id, { status: "done" });

    const { events } = await activity(alice, todo.id);
    expect(events.every((e) => e.actorId.length > 0)).toBe(true);
  });

  it("is not written for someone else's todo", async () => {
    const bob = await signUp("bob@example.com", "Bob");
    await patch(bob, todo.id, { status: "done" });

    const { events } = await activity(alice, todo.id);
    // Bob's attempt changed nothing, so it recorded nothing — a history table
    // that could be written for a todo you cannot see would be a way to learn
    // that it exists.
    expect(events.map((e) => e.field)).toEqual(["created"]);
  });

  it("gives every field changed by one save the same revision", async () => {
    // The form submits everything at once, so a real save often touches
    // several fields. Without a shared id there is nothing in the data saying
    // they were one action, and the screen has to guess from timestamps.
    await patch(alice, todo.id, { status: "in_progress", priority: 2, dueAt: "2026-12-01" });

    const { events } = await activity(alice, todo.id);
    const changed = events.filter((e) => e.field !== "created");

    expect(changed).toHaveLength(3);
    expect(new Set(changed.map((e) => e.revisionId)).size).toBe(1);
  });

  it("gives separate saves separate revisions", async () => {
    await patch(alice, todo.id, { status: "in_progress" });
    await patch(alice, todo.id, { status: "done" });

    const { events } = await activity(alice, todo.id);
    const changed = events.filter((e) => e.field === "status");

    expect(new Set(changed.map((e) => e.revisionId)).size).toBe(2);
  });

  it("attaches a comment written with the change to that change", async () => {
    await patch(alice, todo.id, { status: "blocked", comment: "APIレビュー待ち" });

    const { events, comments } = await activity(alice, todo.id);
    const status = events.find((e) => e.field === "status")!;

    expect(comments).toHaveLength(1);
    // Same revision, which is what lets the screen show the change and its
    // reason as one entry instead of two things that coincided.
    expect(comments[0]!.revisionId).toBe(status.revisionId);
    expect(comments[0]!.body).toBe("APIレビュー待ち");
  });

  it("writes the comment and the change together or not at all", async () => {
    // One batch. A comment explaining a change that did not happen would be
    // worse than no comment.
    const res = await patch(alice, todo.id, { status: "not-a-status", comment: "理由" });

    expect(res.status).toBe(400);
    expect((await activity(alice, todo.id)).comments).toEqual([]);
  });

  it("leaves a standalone comment with no revision", async () => {
    await app.request(
      `/api/todos/${todo.id}/comments`,
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ body: "ただの補足" }) },
      env,
    );

    const { comments } = await activity(alice, todo.id);
    expect(comments[0]!.revisionId).toBeNull();
  });

  it("keeps a note whose save turned out to change nothing", async () => {
    // Its revision has no events, so it has nothing to attach to and renders
    // as an ordinary remark. Discarding what someone wrote because the form
    // happened to submit no changes would be worse than showing it loose.
    await patch(alice, todo.id, { status: "todo", comment: "何も変えていない" });

    const { events, comments } = await activity(alice, todo.id);
    expect(events.map((e) => e.field)).toEqual(["created"]);
    expect(comments.map((c) => c.body)).toEqual(["何も変えていない"]);
  });

  it("cannot be altered through the API at all", async () => {
    // Append-only is the only property that makes it worth having. There is no
    // endpoint that writes to it, and this is the test that notices if one
    // appears.
    await patch(alice, todo.id, { status: "done" });
    const before = (await activity(alice, todo.id)).events;

    await patch(alice, todo.id, { status: "todo" });
    const after = (await activity(alice, todo.id)).events;

    expect(after.slice(0, before.length)).toEqual(before);
  });
});
