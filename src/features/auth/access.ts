import type { AuthState } from "./types";

/**
 * What a screen requires, weakest first.
 *
 * An ordered scale rather than a set of roles, because the roles are already
 * ordered (ADR 0034) — expressing the same order twice would let a screen be
 * marked `["admin"]` and become invisible to the owner who outranks them.
 *
 * This is a scale over *screens*. It is not the project-level scope, where
 * seeing is wide and managing is narrow (ADR 0036); the two answer different
 * questions and are deliberately not the same mechanism.
 */
export const ACCESS_LEVELS = ["public", "user", "admin"] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

/**
 * Route-level declarations, merged into the router's own `staticData`.
 *
 * `access` is absent on most routes on purpose: absent means `user`, so a route
 * added without thinking about this is protected rather than exposed. The
 * previous arrangement was the other way round, and `/dev/design-system` was
 * open to the world because somebody did not copy five lines into it.
 */
/**
 * What a route declares, read out of the router's `staticData`.
 *
 * Deliberately *not* a module augmentation. `StaticDataRouteOption` is an empty
 * interface meant to be augmented, but it lives in `@tanstack/router-core` and
 * reaches us re-exported through `@tanstack/react-router`. Augmenting the
 * re-exporting package declares a second interface that shadows the first, and
 * the route machinery — which still uses the original — loses its generics:
 * `useLoaderData()` becomes `any` across the app, and so does every `Link`'s
 * search parameter. Measured, not guessed; twelve routes went untyped at once.
 *
 * So this reads the value as unknown and narrows it here. The cost is that a
 * misspelled key in a route is not a type error — which is why the audit test
 * asserts the resolved access of every route by name, where a typo shows up as
 * a route that quietly became `user`.
 */
export type RouteAccess = { access?: Access; redirectWhenSignedIn?: boolean };

export function readAccess(staticData: unknown): RouteAccess {
  const data = (staticData ?? {}) as RouteAccess;
  return {
    access: ACCESS_LEVELS.includes(data.access as Access) ? data.access : undefined,
    redirectWhenSignedIn: data.redirectWhenSignedIn === true,
  };
}

/** What a route asks for. Anything undeclared asks for a session. */
export function requiredAccess(staticData: unknown): Access {
  return readAccess(staticData).access ?? "user";
}

/** What this viewer brings. */
export function viewerAccess(auth: AuthState): Access {
  if (!auth.user) return "public";
  const role = auth.user.role;
  return role === "admin" || role === "owner" ? "admin" : "user";
}

export function meets(required: Access, viewer: Access): boolean {
  return ACCESS_LEVELS.indexOf(viewer) >= ACCESS_LEVELS.indexOf(required);
}
