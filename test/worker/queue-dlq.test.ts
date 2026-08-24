import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../../src/worker";
import { DEAD_LETTER_QUEUE, type CleanupMessage } from "../../src/worker/object-cleanup";

const MAIN_QUEUE = "alcyone-object-cleanup";

/** A key R2 will refuse, so the consumer genuinely fails rather than pretending to. */
const POISON = "x".repeat(2000);

async function deliver(queue: string, bodies: CleanupMessage[]) {
  const batch = createMessageBatch<CleanupMessage>(
    queue,
    bodies.map((body, i) => ({ id: `m${i}`, timestamp: new Date(0), body, attempts: 1 })),
  );
  const ctx = createExecutionContext();
  await worker.queue!(batch, env);
  return getQueueResult(batch, ctx);
}

describe("what the queue does with a message it cannot process", () => {
  it("retries the failing message and acks the rest", async () => {
    await env.ATTACHMENTS.put("deletable", "x");

    const result = await deliver(MAIN_QUEUE, [{ keys: ["deletable"] }, { keys: [POISON] }]);

    // Per-message, not per-batch: the good one is done and must not be redone
    // just because the other failed.
    expect(result.explicitAcks).toEqual(["m0"]);
    expect(result.retryMessages ?? result.retryBatch).toBeTruthy();
    expect(await env.ATTACHMENTS.get("deletable")).toBeNull();
  });

  it("acks a dead letter instead of leaving it to be redelivered forever", async () => {
    // By the time a message is here it has already failed as many times as it
    // is allowed to. Retrying it again buys nothing and costs forever.
    const result = await deliver(DEAD_LETTER_QUEUE, [{ keys: [POISON] }]);

    expect(result.explicitAcks).toEqual(["m0"]);
    expect(result.retryMessages ?? []).toEqual([]);
  });

  it("does not run the deletion again on a dead letter", async () => {
    // Routing is by queue name and nothing else. Getting the branch wrong
    // would re-run exactly the work that already failed its retries.
    await env.ATTACHMENTS.put("should-survive", "x");

    await deliver(DEAD_LETTER_QUEUE, [{ keys: ["should-survive"] }]);

    expect(await env.ATTACHMENTS.get("should-survive")).not.toBeNull();
  });
});

/**
 * What is deliberately NOT tested here, and why.
 *
 * `env.OBJECT_CLEANUP.send()` does not drive the consumer under
 * vitest-pool-workers — measured: a message sent through the binding leaves its
 * target object untouched no matter how long the test waits, because the
 * platform's delivery loop is not running. So retry counting, the hand-off to
 * the dead letter queue, and `max_retries` are unobservable here, and the tests
 * above call the handler directly instead.
 *
 * Those three are production-only checks, listed as such in docs/deploy.md. A
 * test that "passed" by waiting and finding nothing would be worse than no test.
 */
