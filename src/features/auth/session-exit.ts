import { authClient } from "@/lib/auth-client";

/**
 * The one way out of a session.
 *
 * A hard navigation rather than a router navigate, and that is the whole point.
 * Signing out has to leave nothing of the previous session behind — not the
 * router's loader cache, not React state, not a list of tasks captured in a
 * closure somewhere. Clearing those one by one puts the guarantee in a review
 * checklist; throwing the page away puts it in the mechanism.
 *
 * The cost is one full page load on an action that happens a few times a day,
 * which is the cheapest guarantee in this codebase.
 *
 * Every exit goes through here — signing out and deleting an account today,
 * and whatever forces a session to end tomorrow. One function, one guarantee.
 */
export async function endSession(): Promise<void> {
  // The server clears the cookie first. Navigating before it answers would race
  // the new page load against a session that is still valid.
  await authClient.signOut();

  // No `redirect` parameter. Signing out is a deliberate exit, and carrying the
  // path over means the next person to sign in on this machine lands on the
  // previous person's screen — the thing the hard navigation above exists to
  // prevent (ADR 0038).
  window.location.assign("/login");
}
