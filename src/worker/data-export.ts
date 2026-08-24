import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { createRepo } from "./db/repo";

export type ExportParams = { userId: string };

/** One part of an export, as recorded in its manifest. */
export type ExportPart = { name: string; key: string; count: number };

export type ExportManifest = {
  userId: string;
  generatedAt: string;
  parts: ExportPart[];
};

/** Everything an export writes lives under this, so it can be found and removed by prefix. */
export const exportPrefix = (userId: string) => `exports/${userId}/`;

export const exportKey = (userId: string, instanceId: string, name: string) =>
  `${exportPrefix(userId)}${instanceId}/${name}.json`;

/**
 * Builds a user's data export.
 *
 * A Workflow rather than a queue because the steps are *dependent* and worth
 * resuming individually: if writing the manifest fails, re-reading the whole
 * database to retry it is waste, and a queue would have no memory of what
 * already succeeded.
 *
 * The shape is dictated by one constraint: a step's return value is persisted,
 * so it has to stay small. Bulk data therefore goes to R2 inside the step and
 * only `{name, key, count}` comes back out. A step that returned the rows
 * themselves would work for a demo account and fail for a real one — which is
 * the failure mode worth designing away rather than discovering.
 */
export class DataExportWorkflow extends WorkflowEntrypoint<CloudflareBindings, ExportParams> {
  async run(event: WorkflowEvent<ExportParams>, step: WorkflowStep): Promise<ExportManifest> {
    const { userId } = event.payload;
    const repo = createRepo(this.env.DB, userId);
    const instanceId = event.instanceId;

    const write = async (name: string, rows: unknown[]): Promise<ExportPart> => {
      const key = exportKey(userId, instanceId, name);
      await this.env.ATTACHMENTS.put(key, JSON.stringify(rows, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
      return { name, key, count: rows.length };
    };

    // One step per entity, so a failure re-runs one query rather than three.
    // Named for what they produce, because the name is the identity a resume
    // matches on — renaming one silently re-runs it.
    const projects = await step.do("export projects", async () =>
      write("projects", await repo.exportable.projects()),
    );
    const todos = await step.do("export todos", async () =>
      write("todos", await repo.exportable.todos()),
    );
    const attachments = await step.do("export attachments", async () =>
      write("attachments", await repo.exportable.attachments()),
    );

    // Written last and on its own, so its existence is what "the export is
    // complete" means. A reader that finds a manifest can trust every part it
    // names is already there.
    return await step.do("write manifest", async () => {
      const manifest: ExportManifest = {
        userId,
        // Inside the step, so a resume does not restamp a finished export.
        generatedAt: new Date().toISOString(),
        parts: [projects, todos, attachments],
      };
      await this.env.ATTACHMENTS.put(
        exportKey(userId, instanceId, "manifest"),
        JSON.stringify(manifest, null, 2),
        { httpMetadata: { contentType: "application/json" } },
      );
      return manifest;
    });
  }
}
