import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import { apiClient } from "@/lib/api-client";

import type { Project } from "./types";

/**
 * The caller's projects, for the switcher in the header.
 *
 * A hook rather than a route loader because the header is not a route — and
 * keyed on `useAuth()` rather than on the router context, which only re-solves
 * on navigation and so would leave the switcher empty on a hard reload until
 * the user clicked something.
 */
export function useProjects(): Project[] {
  const { user } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiClient.api.projects.$get({ query: {} });
        if (!res.ok) return;
        const { items } = await res.json();
        if (!cancelled) setProjects(items as Project[]);
      } catch {
        // Navigation, not content. A failed refresh keeps the list that is
        // already on screen rather than blanking it.
      }
    };

    void load();
    // Every `router.invalidate()` ends in a resolve, so creating or deleting a
    // project updates this list from the page where it happened.
    const unsubscribe = router.subscribe("onResolved", () => void load());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user, router]);

  // Derived rather than cleared in the effect: signing out must not leave the
  // previous account's project names on screen, and writing state during an
  // effect to achieve that only schedules another render.
  return user ? projects : [];
}
