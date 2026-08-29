import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import { exportKey, type ExportManifest } from "../../src/worker/data-export";
import { jsonHeaders, resetAll, signUpAdmin, uniqueKey } from "./auth-helper";

/**
 * The claim ADR 0020 made for choosing Workflows over a queue was that a
 * failure resumes rather than restarts — and it was written without a step
 * having ever failed. These make one fail on purpose.
 */
describe("a data export whose step fails", () => {
  let alice: Headers;
  let userId: string;

  beforeEach(async () => {
    await resetAll();
    alice = await signUpAdmin("alice@example.com", "Alice");
    const session = await app.request("/api/auth/get-session", { headers: alice }, env);
    userId = ((await session.json()) as { user: { id: string } }).user.id;

    await app.request(
      "/api/projects",
      {
        method: "POST",
        headers: jsonHeaders(alice),
        body: JSON.stringify({ name: "Work", key: uniqueKey() }),
      },
      env,
    );
  });

  it("survives a transient failure and still produces a complete export", async () => {
    await using instance = await introspectWorkflowInstance(env.DATA_EXPORT, "resume-1");
    await instance.modify(async (m) => {
      // Waiting out the real backoff would make this test minutes long.
      await m.disableRetryDelays();
      // Fails once, then the real step runs.
      await m.mockStepError({ name: "export todos" }, new Error("transient"), 1);
    });

    await env.DATA_EXPORT.create({ id: "resume-1", params: { userId } });
    await instance.waitForStatus("complete");

    const manifest = (await instance.getOutput()) as ExportManifest;
    // Every part is present and counted: the failure cost time, not data.
    expect(manifest.parts.map((p) => p.name)).toEqual([
      "projects",
      "todos",
      "attachments",
      "comments",
      "events",
    ]);
    expect(manifest.parts.find((p) => p.name === "projects")?.count).toBe(1);

    // And the objects are really in R2, not just named in a return value.
    for (const part of manifest.parts) {
      expect(await env.ATTACHMENTS.get(part.key), part.name).not.toBeNull();
    }
  });

  it("stamps the export once, not once per attempt", async () => {
    // `generatedAt` is taken inside the manifest step for this reason: taken
    // outside, a retry would quietly restate when the data was from.
    await using instance = await introspectWorkflowInstance(env.DATA_EXPORT, "resume-2");
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "write manifest" }, new Error("transient"), 1);
    });

    await env.DATA_EXPORT.create({ id: "resume-2", params: { userId } });
    await instance.waitForStatus("complete");

    const returned = (await instance.getOutput()) as ExportManifest;
    const stored = await env.ATTACHMENTS.get(exportKey(userId, "resume-2", "manifest"));
    const written = (await stored!.json()) as ExportManifest;

    // What the caller is told and what a reader will find must agree.
    expect(written.generatedAt).toBe(returned.generatedAt);
  });

  it("reports a permanent failure as an errored instance rather than a half-written export", async () => {
    await using instance = await introspectWorkflowInstance(env.DATA_EXPORT, "doomed-1");
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      // More failures than the step will retry.
      await m.mockStepError({ name: "export todos" }, new Error("permanent"), 100);
    });

    await env.DATA_EXPORT.create({ id: "doomed-1", params: { userId } });
    await instance.waitForStatus("errored");

    const error = await instance.getError();
    expect(error.message).toContain("permanent");

    // The manifest is written last and alone precisely so that its absence
    // means "not finished". A reader must never find one naming parts that
    // were never written.
    expect(await env.ATTACHMENTS.get(exportKey(userId, "doomed-1", "manifest"))).toBeNull();
  });

  it("does not show a half-finished export through the API", async () => {
    await using instance = await introspectWorkflowInstance(env.DATA_EXPORT, "doomed-2");
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "export attachments" }, new Error("permanent"), 100);
    });

    await env.DATA_EXPORT.create({ id: "doomed-2", params: { userId } });
    await instance.waitForStatus("errored");

    const res = await app.request("/api/exports/doomed-2", { headers: alice }, env);
    expect(((await res.json()) as { manifest: unknown }).manifest).toBeNull();
  });
});
