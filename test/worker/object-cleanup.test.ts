import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../../src/worker";
import {
  deleteObjectsNow,
  enqueueObjectCleanup,
  handleObjectCleanup,
  type CleanupMessage,
} from "../../src/worker/object-cleanup";
import { RETENTION_DAYS, purgeExpiredDeletions } from "../../src/worker/scheduled";
import { resetAll, signUp } from "./auth-helper";

const DAY = 24 * 60 * 60 * 1000;

/** Records what was sent instead of reaching a real queue. */
function fakeQueue() {
  const sent: CleanupMessage[] = [];
  const queue = {
    send: async (body: CleanupMessage) => {
      sent.push(body);
    },
    sendBatch: async (messages: Iterable<{ body: CleanupMessage }>) => {
      for (const m of messages) sent.push(m.body);
    },
  } as unknown as Queue<CleanupMessage>;
  return { queue, sent };
}

/** A batch shaped like the runtime's, recording ack/retry per message. */
function fakeBatch(bodies: CleanupMessage[]) {
  const acked: number[] = [];
  const retried: number[] = [];
  const messages = bodies.map((body, i) => ({
    id: String(i),
    body,
    attempts: 1,
    ack: () => acked.push(i),
    retry: () => retried.push(i),
  }));
  return {
    batch: { queue: "alcyone-object-cleanup", messages } as unknown as MessageBatch<CleanupMessage>,
    acked,
    retried,
  };
}

describe("object cleanup queue", () => {
  it("splits keys across messages so no message exceeds R2's per-call limit", async () => {
    const { queue, sent } = fakeQueue();

    await enqueueObjectCleanup(
      queue,
      Array.from({ length: 250 }, (_, i) => `k${i}`),
    );

    expect(sent).toHaveLength(3);
    expect(sent.flatMap((m) => m.keys)).toHaveLength(250);
    for (const m of sent) expect(m.keys.length).toBeLessThanOrEqual(100);
  });

  it("sends nothing for no keys", async () => {
    const { queue, sent } = fakeQueue();
    await enqueueObjectCleanup(queue, []);
    expect(sent).toEqual([]);
  });

  it("deletes the objects a message names", async () => {
    await env.ATTACHMENTS.put("gone-1", "x");
    await env.ATTACHMENTS.put("gone-2", "x");
    await env.ATTACHMENTS.put("kept", "x");

    const { batch, acked } = fakeBatch([{ keys: ["gone-1", "gone-2"] }]);
    await handleObjectCleanup(batch, env);

    expect(acked).toEqual([0]);
    expect(await env.ATTACHMENTS.get("gone-1")).toBeNull();
    expect(await env.ATTACHMENTS.get("kept")).not.toBeNull();
  });

  it("treats an already-deleted object as done rather than as a failure", async () => {
    // Retries are the queue's whole safety mechanism, so deleting twice has to
    // be harmless or a retry storm is one crash away.
    const { batch, acked, retried } = fakeBatch([{ keys: ["never-existed"] }]);
    await handleObjectCleanup(batch, env);

    expect(acked).toEqual([0]);
    expect(retried).toEqual([]);
  });

  it("acks the messages it can handle even when one fails", async () => {
    // Per-message rather than per-batch: retrying the whole batch would redo
    // ninety-nine successful deletions to reach the one that failed.
    await env.ATTACHMENTS.put("fine", "x");
    const { batch, acked, retried } = fakeBatch([{ keys: ["fine"] }, { keys: ["explodes"] }]);

    const brokenEnv = {
      ...env,
      ATTACHMENTS: {
        delete: async (keys: string[] | string) => {
          if (Array.isArray(keys) && keys.includes("explodes")) throw new Error("boom");
          return env.ATTACHMENTS.delete(keys);
        },
      } as unknown as R2Bucket,
    };
    await handleObjectCleanup(batch, brokenEnv as typeof env);

    expect(acked).toEqual([0]);
    expect(retried).toEqual([1]);
    expect(await env.ATTACHMENTS.get("fine")).toBeNull();
  });

  it("runs from the Worker's queue handler", async () => {
    // The wiring is the part that would silently stop running.
    await env.ATTACHMENTS.put("via-handler", "x");
    const { batch, acked } = fakeBatch([{ keys: ["via-handler"] }]);

    await worker.queue!(batch, env);

    expect(acked).toEqual([0]);
    expect(await env.ATTACHMENTS.get("via-handler")).toBeNull();
  });

  it("chunks a direct delete past R2's per-call limit", async () => {
    const seen: number[] = [];
    const bucket = {
      delete: async (keys: string[] | string) => {
        seen.push(Array.isArray(keys) ? keys.length : 1);
      },
    } as unknown as R2Bucket;

    await deleteObjectsNow(
      bucket,
      Array.from({ length: 250 }, (_, i) => `k${i}`),
    );

    expect(seen).toEqual([100, 100, 50]);
  });
});

describe("purging todos that have attachments", () => {
  let ownerId: string;

  beforeEach(async () => {
    await resetAll();
    await signUp("owner@example.com");
    const row = await env.DB.prepare("SELECT id FROM user LIMIT 1").first<{ id: string }>();
    ownerId = row!.id;
  });

  async function seedExpiredTodoWithAttachment(key: string) {
    const expired = new Date(Date.now() - (RETENTION_DAYS + 1) * DAY).toISOString();
    const { meta: p } = await env.DB.prepare(
      "INSERT INTO projects (name, createdAt, ownerId, deletedAt) VALUES ('p', ?, ?, ?)",
    )
      .bind(expired, ownerId, expired)
      .run();
    const { meta: t } = await env.DB.prepare(
      "INSERT INTO todos (title, createdAt, updatedAt, projectId, deletedAt) VALUES ('with file', ?, ?, ?, ?)",
    )
      .bind(expired, expired, p.last_row_id, expired)
      .run();
    await env.DB.prepare(
      "INSERT INTO attachments (todoId, key, filename, contentType, size, createdAt) VALUES (?, ?, 'f.txt', 'text/plain', 3, ?)",
    )
      .bind(t.last_row_id, key, expired)
      .run();
    await env.ATTACHMENTS.put(key, "abc");
  }

  it("completes instead of failing the whole run on a foreign key", async () => {
    // The regression this file exists for. `attachments.todoId` references
    // `todos.id` with NO ACTION, and the purge is one batch — so a single
    // expired todo with a file attached made the nightly job throw, and
    // *nothing* was purged for *anyone*. Silent: the only symptom was an error
    // in a cron log.
    await seedExpiredTodoWithAttachment("purge-me");

    const result = await purgeExpiredDeletions(env);

    expect(result).toMatchObject({ todos: 1, projects: 1, objects: 1 });
    const left = await env.DB.prepare(
      "SELECT (SELECT count(*) FROM todos) AS t, (SELECT count(*) FROM attachments) AS a",
    ).first<{ t: number; a: number }>();
    expect(left).toMatchObject({ t: 0, a: 0 });
  });

  it("hands the orphaned object keys to the queue", async () => {
    await seedExpiredTodoWithAttachment("purge-me");

    await purgeExpiredDeletions(env);

    // The object is not deleted by the purge itself — that is the point of the
    // queue — so it is still there, now owned by a message.
    expect(await env.ATTACHMENTS.get("purge-me")).not.toBeNull();

    const { batch } = fakeBatch([{ keys: ["purge-me"] }]);
    await handleObjectCleanup(batch, env);
    expect(await env.ATTACHMENTS.get("purge-me")).toBeNull();
  });

  it("leaves attachments of todos that are still within retention", async () => {
    const recent = new Date(Date.now() - DAY).toISOString();
    const { meta: p } = await env.DB.prepare(
      "INSERT INTO projects (name, createdAt, ownerId, deletedAt) VALUES ('p', ?, ?, ?)",
    )
      .bind(recent, ownerId, recent)
      .run();
    const { meta: t } = await env.DB.prepare(
      "INSERT INTO todos (title, createdAt, updatedAt, projectId, deletedAt) VALUES ('recent', ?, ?, ?, ?)",
    )
      .bind(recent, recent, p.last_row_id, recent)
      .run();
    await env.DB.prepare(
      "INSERT INTO attachments (todoId, key, filename, contentType, size, createdAt) VALUES (?, 'keep', 'f.txt', 'text/plain', 3, ?)",
    )
      .bind(t.last_row_id, recent)
      .run();

    const result = await purgeExpiredDeletions(env);

    // Undo has to keep working inside the window, files included.
    expect(result).toMatchObject({ todos: 0, projects: 0, objects: 0 });
    const row = await env.DB.prepare("SELECT count(*) AS n FROM attachments").first<{
      n: number;
    }>();
    expect(row?.n).toBe(1);
  });
});
