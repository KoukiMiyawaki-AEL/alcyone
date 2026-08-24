/**
 * Per-request D1 session, for read-your-own-writes across read replicas.
 *
 * D1 can serve reads from replicas, which are *behind* the primary. Without
 * anything tying a user's requests together, a perfectly ordinary sequence —
 * create a project, then load the list — can land on a replica that has not
 * caught up, and the project the user just made is missing. It appears once
 * they reload, which makes it look like a flaky bug rather than a consistency
 * model.
 *
 * A session fixes an ordering: every query in it is at least as fresh as the
 * bookmark it was anchored to. Carrying that bookmark forward between requests
 * is what extends the guarantee past a single one.
 *
 * None of this is observable locally — miniflare has one database and no
 * replicas — so the wiring is what the tests can check, not the benefit.
 */

/** Where the bookmark rides between requests. */
export const BOOKMARK_COOKIE = "d1-bookmark";

/**
 * `first-unconstrained` rather than `first-primary` for a first-time visitor:
 * with no bookmark there is nothing to be consistent *with*, so forcing the
 * primary would cost latency to guarantee something nobody asked for.
 */
const NO_BOOKMARK = "first-unconstrained";

export function readBookmark(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === BOOKMARK_COOKIE && rest.length > 0) {
      const value = decodeURIComponent(rest.join("="));
      return value === "" ? null : value;
    }
  }
  return null;
}

export function openSession(db: D1Database, cookieHeader: string | undefined): D1DatabaseSession {
  const bookmark = readBookmark(cookieHeader);
  // A stale or unrecognised bookmark is a position, not an instruction: falling
  // back to unconstrained costs freshness, while failing the request over a
  // cookie the user never sees would be absurd.
  try {
    return db.withSession(bookmark ?? NO_BOOKMARK);
  } catch {
    return db.withSession(NO_BOOKMARK);
  }
}

/**
 * The Set-Cookie value carrying a bookmark forward, or null if the session ran
 * no queries.
 *
 * HttpOnly because nothing in the browser has any use for it, and `Secure`
 * off only where there is no TLS to be had — local development.
 */
export function bookmarkCookie(session: D1DatabaseSession, url: string): string | null {
  const bookmark = session.getBookmark();
  if (!bookmark) return null;

  const secure = new URL(url).protocol === "https:" ? "; Secure" : "";
  // A day: long enough to cover a session of use, short enough that a bookmark
  // nobody has used in that long is not worth carrying.
  return `${BOOKMARK_COOKIE}=${encodeURIComponent(bookmark)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`;
}
