/**
 * Deleting R2 objects, off the request and cron paths.
 *
 * The database is the only thing that knows an object should be gone, and it
 * forgets the moment the row is deleted. So the two have to be ordered, and
 * neither order is free:
 *
 * - Rows first, then objects: a crash in between strands the object with
 *   nothing pointing at it. Invisible, and billed forever.
 * - Objects first, then rows: a crash in between leaves a row whose download
 *   404s. Visible, and repairable.
 *
 * This picks the second, which is the same choice account deletion already
 * made. Handing the keys to a queue before the rows go means the intent
 * survives a crash, since the queue retries.
 */

/** R2 accepts at most 1000 keys per delete, and a queue message must stay small. */
const KEYS_PER_MESSAGE = 100;

/** A queue accepts at most 100 messages per sendBatch call. */
const MESSAGES_PER_SEND = 100;

export type CleanupMessage = { keys: string[] };

/**
 * Every object under a prefix.
 *
 * R2 lists in pages, and a caller that ignores `truncated` silently deletes
 * only the first thousand — which looks like success.
 */
export async function listKeys(
  bucket: R2Bucket,
  prefix: string,
  keepIf?: (object: R2Object) => boolean,
): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects) {
      if (!keepIf || keepIf(object)) keys.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return keys;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Queues object keys for deletion.
 *
 * Awaited by callers rather than fired off: the point of the queue is to move
 * the *deletion* off the critical path, not to make the handoff unreliable. If
 * the enqueue fails the caller must not go on to delete the rows.
 */
export async function enqueueObjectCleanup(
  queue: Queue<CleanupMessage>,
  keys: string[],
): Promise<void> {
  const messages = chunk(keys, KEYS_PER_MESSAGE).map((body) => ({ body: { keys: body } }));

  for (const group of chunk(messages, MESSAGES_PER_SEND)) {
    await queue.sendBatch(group);
  }
}

/**
 * Deletes objects directly, for callers that must not return until they are
 * gone — account deletion, where "your data is deleted" has to be true when
 * the response is sent.
 *
 * Chunked for the same 1000-key limit. Without this, an account with more
 * attachments than that would fail to delete at all.
 */
export async function deleteObjectsNow(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (const group of chunk(keys, KEYS_PER_MESSAGE)) {
    await bucket.delete(group);
  }
}

/**
 * Queue consumer.
 *
 * Acks and retries per message rather than per batch: one bad message must not
 * make ninety-nine good ones run again, which at best doubles the work and at
 * worst never converges.
 */
export async function handleObjectCleanup(
  batch: MessageBatch<CleanupMessage>,
  env: CloudflareBindings,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await deleteObjectsNow(env.ATTACHMENTS, message.body.keys);
      message.ack();
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          message: "object cleanup failed",
          keys: message.body.keys.length,
          attempts: message.attempts,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      message.retry();
    }
  }
}
