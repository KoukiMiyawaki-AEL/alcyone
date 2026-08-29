import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ShieldIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { AppHeader } from "@/components/app/app-header";
import { AppSidebar } from "@/components/app/app-sidebar";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { meets, readAccess, requiredAccess, viewerAccess } from "@/features/auth/access";
import { useAuth } from "@/features/auth/AuthProvider";

/**
 * Decides who sees what. The only place that does.
 *
 * A render-time gate rather than a `beforeLoad` guard, because `beforeLoad`
 * cannot do this job: it runs on navigation, and signing out is not a
 * navigation. Seven routes carried an identical guard that had never once
 * bounced anybody on sign-out — the screens that did bounce were the ones whose
 * loader happened to make a request that 401'd, which is why `/search` (which
 * skips the request when the box is empty) and `/account` (which has no loader)
 * simply stayed put. Measured, not guessed (ADR 0038).
 *
 * Gating at render is what makes the rule enforceable: a protected route's
 * component and loader do not run at all unless the session is there.
 */
export function AccessGate() {
  const auth = useAuth();
  const navigate = useNavigate();

  // The deepest match's declaration. `staticData` is inherited from the root
  // down, so a route that declares nothing gets the root's — which declares
  // nothing either, and therefore means `user`.
  const staticData = useRouterState({
    select: (state) => state.matches.at(-1)?.staticData,
  });
  /**
   * Where a signed-in visitor on a public screen should be sent, or null.
   *
   * One selector rather than two, and that is load-bearing: reading "is this
   * screen public" and "where were they going" from separate subscriptions
   * meant the effect could run with a pair from two different moments of the
   * same navigation. It did — the redirect fired correctly and was then
   * overwritten by a third run that still saw the old route with the new
   * (empty) search. One snapshot cannot disagree with itself.
   */
  const destination = useRouterState({
    select: (state) => {
      const data = readAccess(state.matches.at(-1)?.staticData);
      if (data.access !== "public" || !data.redirectWhenSignedIn) return null;
      // Set by the loaders' 401 handling — never by signing out, which is a
      // deliberate exit and carries nothing over (ADR 0038).
      return (state.location.search as { redirect?: string }).redirect ?? "/";
    },
  });

  const required = requiredAccess(staticData);
  const viewer = viewerAccess(auth);
  const allowed = meets(required, viewer);

  // The login screen, once you are in. Reacting to the session appearing is the
  // one ordering that holds: a redirect decided during navigation fights the
  // other direction over a context that lags by a render, which is a loop
  // rather than a race. With a single owner there is nothing to fight.
  const leavePublic = destination !== null && auth.user !== null;
  // Nothing to wait for on a public route: "public" means this screen does not
  // need a session, not that it needs to know there isn't one. A shared link is
  // the first screen its reader ever sees of this app, and making them wait for
  // somebody else's session would be the slowest possible introduction.
  const waiting = required !== "public" && auth.isPending;
  const bounce = required !== "public" && !waiting && auth.user === null;

  // Sent once per visit to a public screen, and that is not belt-and-braces.
  // While a navigation is in flight the router's `matches` and `location`
  // disagree for a moment: the matches still name the login screen while the
  // search has already become the destination's, which has no `redirect` in it.
  // The effect then ran a second time, computed "/" and overwrote the correct
  // destination — measured, after the first fix made the pair consistent
  // without making it stable.
  const sent = useRef(false);

  useEffect(() => {
    if (destination === null) {
      sent.current = false;
      return;
    }
    if (!auth.user || sent.current) return;

    sent.current = true;
    void navigate({ to: destination });
  }, [destination, auth.user, navigate]);

  useEffect(() => {
    if (!bounce) return;
    // `replace`, so the protected URL leaves the history rather than sitting
    // there as a back button that tries again.
    void navigate({ to: "/login", replace: true });
  }, [bounce, navigate]);

  if (required === "public") {
    // Outside the shell. The header and sidebar are the furniture of a signed-in
    // session; around a shared link they are a table of contents to somebody
    // else's app, every entry of which bounces the reader to a login screen.
    return leavePublic ? <Waiting /> : <Outlet />;
  }

  if (waiting || bounce) return <Waiting />;

  if (!allowed) {
    return (
      <Shell>
        <EmptyState
          icon={ShieldIcon}
          title="権限がありません"
          description="この画面を開けるのは管理者とオーナーだけです。"
          action={
            <Button size="sm" variant="outline" render={<Link to="/" />}>
              プロジェクトへ戻る
            </Button>
          }
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/**
 * While the session is still being fetched.
 *
 * Not the shell with a skeleton inside it: the header holds the account menu
 * and the project switcher, both of which read the session, so showing it early
 * means an empty switcher and a nameless account button, replaced a moment
 * later. Waiting and then drawing the right thing once is less to look at than
 * drawing the wrong thing quickly.
 */
function Waiting() {
  return (
    <div className="flex h-svh items-center justify-center bg-background text-foreground">
      <span
        role="status"
        aria-label="読み込み中"
        className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground"
      />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <AppHeader />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
