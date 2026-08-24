import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { exportKey, exportPrefix, type ExportManifest } from "../../src/worker/data-export";
import { handleObjectCleanup } from "../../src/worker/object-cleanup";
import { RETENTION_DAYS, purgeExpiredDeletions } from "../../src/worker/scheduled";
import { jsonHeaders, resetAll, signUp } from "./auth-helper";

async function createProject(headers: Headers, name = "Work"): Promise<number> {
  const res = await app.request(
    "/api/projects",
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ name }) },
    env,
  );
  return ((await res.json()) as { id: number }).id;
}

async function userId(headers: Headers): Promise<string> {
  const res = await app.request("/api/auth/get-session", { headers }, env);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

/** Polls until the manifest exists, since the workflow runs on its own clock. */
async function waitForManifest(
  headers: Headers,
  id: string,
  attempts = 60,
): Promise<ExportManifest | null> {
  for (let i = 0; i < attempts; i++) {
    const res = await app.request(`/api/exports/${id}`, { headers }, env);
    const body = (await res.json()) as { manifest: ExportManifest | null };
    if (body.manifest) return body.manifest;
    await scheduler.wait(50);
  }
  return null;
}

describe("data export", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
  });

  it("writes every part and a manifest naming them", async () => {
    const projectId = await createProject(alice);
    await app.request(
      `/api/projects/${projectId}/todos`,
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ title: "exported" }) },
      env,
    );

    const started = await app.request("/api/exports", { method: "POST", headers: alice }, env);
    expect(started.status).toBe(202);
    const { id } = (await started.json()) as { id: string };

    const manifest = await waitForManifest(alice, id);
    expect(manifest).not.toBeNull();
    expect(manifest!.parts.map((p) => p.name)).toEqual(["projects", "todos", "attachments"]);
    expect(manifest!.parts.find((p) => p.name === "projects")?.count).toBe(1);
    expect(manifest!.parts.find((p) => p.name === "todos")?.count).toBe(1);
  });

  it("serves a part as a download", async () => {
    await createProject(alice, "Downloadable");
    const started = await app.request("/api/exports", { method: "POST", headers: alice }, env);
    const { id } = (await started.json()) as { id: string };
    await waitForManifest(alice, id);

    const res = await app.request(`/api/exports/${id}/projects`, { headers: alice }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("projects.json");
    expect(((await res.json()) as { name: string }[]).map((p) => p.name)).toEqual(["Downloadable"]);
  });

  it("includes soft-deleted rows, marked as deleted", async () => {
    // A user asking for their data should see what the service holds. Hiding
    // rows we still have would be the wrong answer to that question.
    const projectId = await createProject(alice, "Trashed");
    await app.request(`/api/projects/${projectId}`, { method: "DELETE", headers: alice }, env);

    const started = await app.request("/api/exports", { method: "POST", headers: alice }, env);
    const { id } = (await started.json()) as { id: string };
    await waitForManifest(alice, id);

    const res = await app.request(`/api/exports/${id}/projects`, { headers: alice }, env);
    const rows = (await res.json()) as { name: string; deletedAt: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).not.toBeNull();
  });

  it("does not hand another user's export over", async () => {
    // The instance id is the only thing the caller supplies, and it proves
    // nothing about ownership — the key is built from the session instead.
    const bob = await signUp("bob@example.com", "Bob");
    await createProject(alice, "Alice's");
    const started = await app.request("/api/exports", { method: "POST", headers: alice }, env);
    const { id } = (await started.json()) as { id: string };
    await waitForManifest(alice, id);

    const status = await app.request(`/api/exports/${id}`, { headers: bob }, env);
    expect(((await status.json()) as { manifest: unknown }).manifest).toBeNull();

    const part = await app.request(`/api/exports/${id}/projects`, { headers: bob }, env);
    expect(part.status).toBe(404);
  });

  it("rejects a part name that is not one of the known ones", async () => {
    // `part` lands in an R2 key, so a free-form value would be a way out of
    // the caller's own prefix.
    const res = await app.request(
      "/api/exports/whatever/..%2F..%2Fsecret",
      { headers: alice },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("expires an old export through the retention job", async () => {
    // An export is a copy of everything the user had at that moment, so
    // keeping it forever would quietly undo both the retention window and the
    // soft-delete window it was taken during.
    //
    // R2 stamps `uploaded` itself and it cannot be backdated, so the clock is
    // moved instead of the object.
    const id = await userId(alice);
    await createProject(alice, "Old");
    const started = await app.request("/api/exports", { method: "POST", headers: alice }, env);
    const { id: instanceId } = (await started.json()) as { id: string };
    await waitForManifest(alice, instanceId);

    const later = new Date(Date.now() + (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    const result = await purgeExpiredDeletions(env, later);

    // The purge hands the keys to the queue rather than deleting them itself.
    expect(result.objects).toBeGreaterThan(0);

    const keys = (await env.ATTACHMENTS.list({ prefix: exportPrefix(id) })).objects.map(
      (o) => o.key,
    );
    await handleObjectCleanup(
      {
        queue: "alcyone-object-cleanup",
        messages: [{ id: "0", body: { keys }, attempts: 1, ack: () => {}, retry: () => {} }],
      } as unknown as MessageBatch<{ keys: string[] }>,
      env,
    );

    expect((await env.ATTACHMENTS.list({ prefix: exportPrefix(id) })).objects).toEqual([]);
  });

  it("keeps an export that is still inside the retention window", async () => {
    const id = await userId(alice);
    await createProject(alice, "Fresh");
    const started = await app.request("/api/exports", { method: "POST", headers: alice }, env);
    const { id: instanceId } = (await started.json()) as { id: string };
    await waitForManifest(alice, instanceId);

    await purgeExpiredDeletions(env);

    expect(
      (await env.ATTACHMENTS.list({ prefix: exportPrefix(id) })).objects.length,
    ).toBeGreaterThan(0);
  });

  it("takes the export with the account when it is deleted", async () => {
    const id = await userId(alice);
    await createProject(alice, "Doomed");
    const started = await app.request("/api/exports", { method: "POST", headers: alice }, env);
    const { id: instanceId } = (await started.json()) as { id: string };
    await waitForManifest(alice, instanceId);

    expect(await env.ATTACHMENTS.get(exportKey(id, instanceId, "manifest"))).not.toBeNull();

    const res = await app.request(
      "/api/auth/delete-user",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({}) },
      env,
    );
    expect(res.ok).toBe(true);

    // An export is the user's own data written back out. Leaving it behind
    // would make "delete my account" false in the most literal way.
    const { objects } = await env.ATTACHMENTS.list({ prefix: exportPrefix(id) });
    expect(objects).toEqual([]);
  });
});
