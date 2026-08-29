import { createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { requiredAccess, viewerAccess, meets, type Access } from "@/features/auth/access";
// Type-only, and erased at run time: it brings in the `Register` declaration
// from the entry point without executing it. Without that declaration this
// project has an unregistered router, and every route file it pulls in loses
// its generics — which surfaces as "implicitly has an 'any' type" in a dozen
// files nowhere near this test.
import type {} from "@/main";
import { routeTree } from "@/routeTree.gen";

/**
 * The audit list, as a test rather than as a table.
 *
 * A table of paths in a file goes stale silently — rename a route and the entry
 * points at nothing. This walks the route tree the app actually uses, so a new
 * route cannot arrive without somebody deciding what it is.
 */
function everyRoute(): { id: string; access: Access }[] {
  // Built the way the app builds it: the route objects only get their ids when
  // a router is created from them, so walking the exported tree directly finds
  // routes with no id to report.
  // The context is only needed to satisfy the router's type; nothing here
  // renders, so an empty session is enough.
  const router = createRouter({ routeTree, context: { auth: { user: null, isPending: false } } });

  return Object.entries(router.routesById)
    .filter(([id]) => id !== "__root__")
    .map(([id, route]) => ({
      id,
      access: requiredAccess(
        (route as { options?: { staticData?: { access?: Access } } }).options?.staticData,
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

describe("which screens are public", () => {
  it("is exactly the login form and a shared link", () => {
    // The whole allowlist, in one assertion. Adding a route without deciding
    // what it needs fails here — and it fails *closed*, because an undeclared
    // route counts as requiring a session.
    const publicRoutes = everyRoute()
      .filter((route) => route.access === "public")
      .map((route) => route.id);

    expect(publicRoutes).toEqual(["/login", "/s/$token"]);
  });

  it("requires a session everywhere else, including the screens with no data", () => {
    // `/dev/design-system` was reachable signed out for months, because
    // protecting a route used to mean copying five lines into it and somebody
    // did not. Absent now means protected.
    const byId = Object.fromEntries(everyRoute().map((route) => [route.id, route.access]));

    expect(byId["/dev/design-system"]).toBe("user");
    expect(byId["/admin"]).toBe("admin");
    expect(byId["/account"]).toBe("user");
    expect(byId["/search"]).toBe("user");
  });

  it("names every route it found, so an unlisted one is visible here", () => {
    expect(everyRoute().map((route) => `${route.access} ${route.id}`)).toEqual([
      "user /",
      "user /account",
      "admin /admin",
      "user /dev/design-system",
      "public /login",
      "user /my",
      "user /projects_/$projectId/settings",
      "user /projects/$projectId",
      "public /s/$token",
      "user /search",
    ]);
  });
});

describe("the access scale", () => {
  it("treats an owner as satisfying an administrator's screen", () => {
    // The roles are already ordered. Expressing that order a second
    // time as a set is how an owner ends up locked out of an admin screen.
    expect(
      meets("admin", viewerAccess({ user: { role: "owner" } as never, isPending: false })),
    ).toBe(true);
    expect(
      meets("admin", viewerAccess({ user: { role: "admin" } as never, isPending: false })),
    ).toBe(true);
    expect(
      meets("admin", viewerAccess({ user: { role: "member" } as never, isPending: false })),
    ).toBe(false);
  });

  it("gives a signed-out visitor the public level and nothing more", () => {
    const viewer = viewerAccess({ user: null, isPending: false });

    expect(meets("public", viewer)).toBe(true);
    expect(meets("user", viewer)).toBe(false);
    expect(meets("admin", viewer)).toBe(false);
  });
});
