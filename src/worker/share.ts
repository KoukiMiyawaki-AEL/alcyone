import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { projectsTable, sharesTable, todosTable } from "./db/schema";

/**
 * What a shared link shows. Deliberately not the database rows: this is served
 * to anyone holding the link, so the shape is chosen rather than inherited.
 * No ids, no owner, no timestamps beyond what the view needs.
 */
export type SharedView = {
  project: { name: string };
  todos: { title: string; completed: boolean; dueAt: string | null; priority: number }[];
};

/**
 * How long KV may serve a snapshot before it must be rebuilt.
 *
 * This is the staleness the feature accepts. A minute is short enough that an
 * edit shows up while the person you sent the link to is still reading, and
 * long enough that a link doing the rounds does not hit D1 once per viewer —
 * which is the entire reason KV is here.
 */
export const SHARE_TTL_SECONDS = 60;

const cacheKey = (token: string) => `share:${token}`;

/**
 * A token nobody can guess.
 *
 * `crypto.getRandomValues`, not `Math.random`: this string is the only thing
 * standing between a project and the open internet. 32 bytes of base64url.
 */
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** Reads the shared project straight from D1. The authority, and the slow path. */
export async function readSharedView(
  db: D1Database | D1DatabaseSession,
  token: string,
): Promise<SharedView | null> {
  const orm = drizzle(db as D1Database);

  const [row] = await orm
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(sharesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, sharesTable.projectId))
    .where(and(eq(sharesTable.token, token), isNull(projectsTable.deletedAt)))
    .limit(1);

  // A soft-deleted project stops being shared without the link being revoked —
  // deleting it is a clearer statement of intent than the link outliving it.
  if (!row) return null;

  const todos = await orm
    .select({
      title: todosTable.title,
      completed: todosTable.completed,
      dueAt: todosTable.dueAt,
      priority: todosTable.priority,
    })
    .from(todosTable)
    .where(and(eq(todosTable.projectId, row.id), isNull(todosTable.deletedAt)))
    .orderBy(todosTable.id);

  return { project: { name: row.name }, todos };
}

/**
 * The read path a public visitor takes: KV first, D1 only on a miss.
 *
 * `cacheTtl` asks the edge to hold its own copy too, so a popular link is
 * answered near the reader instead of from KV's origin every time.
 */
export async function getSharedView(
  cache: KVNamespace,
  db: D1Database | D1DatabaseSession,
  token: string,
): Promise<SharedView | null> {
  const cached = await cache.get<SharedView>(cacheKey(token), {
    type: "json",
    cacheTtl: SHARE_TTL_SECONDS,
  });
  if (cached) return cached;

  const view = await readSharedView(db, token);
  if (!view) return null;

  await cache.put(cacheKey(token), JSON.stringify(view), {
    expirationTtl: SHARE_TTL_SECONDS,
  });
  return view;
}

/**
 * Drops the cached snapshot.
 *
 * Worth being precise about what this does and does not guarantee: KV is
 * eventually consistent, so a delete is not instant everywhere, and a replica
 * can keep answering with the old value for up to the TTL. Revoking a link is
 * therefore effective *within a minute*, not immediately.
 *
 * That is the trade this feature accepts, and it is only acceptable because the
 * TTL is short and the thing being protected is a read-only task list. For
 * anything where revocation has to bite at once, the cache is the wrong tool —
 * checking D1 every time is exactly what it was introduced to avoid.
 */
export async function purgeSharedView(cache: KVNamespace, token: string): Promise<void> {
  await cache.delete(cacheKey(token));
}
