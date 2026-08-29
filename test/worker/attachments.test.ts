import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { jsonHeaders, PASSWORD, resetAll, signUp, signUpAdmin, uniqueKey } from "./auth-helper";

type Attachment = { id: number; filename: string; contentType: string; size: number; key: string };

async function createTodo(headers: Headers): Promise<number> {
  const project = (await (
    await app.request(
      "/api/projects",
      {
        method: "POST",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ name: "P", key: uniqueKey() }),
      },
      env,
    )
  ).json()) as { id: number };

  const todo = (await (
    await app.request(
      `/api/projects/${project.id}/todos`,
      { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title: "T" }) },
      env,
    )
  ).json()) as { id: number };

  return todo.id;
}

async function upload(
  headers: Headers,
  todoId: number,
  name: string,
  body: string,
  type = "text/plain",
) {
  const form = new FormData();
  form.set("file", new File([body], name, { type }));
  // No Content-Type header: the browser sets the multipart boundary.
  const h = new Headers(headers);
  h.delete("Content-Type");
  return app.request(
    `/api/todos/${todoId}/attachments`,
    { method: "POST", headers: h, body: form },
    env,
  );
}

async function countObjects(): Promise<number> {
  return (await env.ATTACHMENTS.list()).objects.length;
}

describe("attachments", () => {
  let headers: Headers;
  let todoId: number;

  beforeEach(async () => {
    await resetAll();
    for (const object of (await env.ATTACHMENTS.list()).objects) {
      await env.ATTACHMENTS.delete(object.key);
    }
    headers = await signUpAdmin("owner@example.com");
    todoId = await createTodo(headers);
  });

  it("uploads, lists and downloads a file", async () => {
    const created = await upload(headers, todoId, "notes.txt", "hello r2");
    expect(created.status).toBe(201);
    const attachment = (await created.json()) as Attachment;
    expect(attachment).toMatchObject({ filename: "notes.txt", contentType: "text/plain", size: 8 });

    const listed = (await (
      await app.request(`/api/todos/${todoId}/attachments`, { headers }, env)
    ).json()) as Attachment[];
    expect(listed.map((a) => a.filename)).toEqual(["notes.txt"]);

    const download = await app.request(`/api/attachments/${attachment.id}`, { headers }, env);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("hello r2");
    // Never inline: these are arbitrary uploads on our own origin.
    expect(download.headers.get("content-disposition")).toContain("attachment");
  });

  it("gives each upload an unguessable key, even for the same filename", async () => {
    const a = (await (await upload(headers, todoId, "same.txt", "one")).json()) as Attachment;
    const b = (await (await upload(headers, todoId, "same.txt", "two")).json()) as Attachment;

    expect(a.key).not.toBe(b.key);
    expect(await countObjects()).toBe(2);
  });

  it("rejects an upload to a todo that is not yours, without writing to R2", async () => {
    const bob = await signUp("bob@example.com");

    const res = await upload(bob, todoId, "intruder.txt", "nope");

    expect(res.status).toBe(404);
    // The ownership check has to come before the write, or R2 collects objects
    // no row will ever reference.
    expect(await countObjects()).toBe(0);
  });

  it("does not let another user download or delete", async () => {
    const attachment = (await (
      await upload(headers, todoId, "private.txt", "secret")
    ).json()) as Attachment;
    const bob = await signUp("bob@example.com");

    expect(
      (await app.request(`/api/attachments/${attachment.id}`, { headers: bob }, env)).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/attachments/${attachment.id}`,
          { method: "DELETE", headers: bob },
          env,
        )
      ).status,
    ).toBe(404);
    expect(await countObjects()).toBe(1);
  });

  it("deletes the object along with the row", async () => {
    const attachment = (await (
      await upload(headers, todoId, "gone.txt", "bye")
    ).json()) as Attachment;
    expect(await countObjects()).toBe(1);

    const res = await app.request(
      `/api/attachments/${attachment.id}`,
      { method: "DELETE", headers },
      env,
    );
    expect(res.status).toBe(204);
    expect(await countObjects()).toBe(0);
  });

  it("removes stored objects when the account is deleted", async () => {
    await upload(headers, todoId, "a.txt", "one");
    await upload(headers, todoId, "b.txt", "two");
    expect(await countObjects()).toBe(2);

    await app.request(
      "/api/auth/delete-user",
      {
        method: "POST",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ password: PASSWORD }),
      },
      env,
    );

    // Rows alone are not enough: R2 is outside the database, so an account
    // deletion that only clears tables leaves the files behind forever.
    expect(await countObjects()).toBe(0);
  });
});
