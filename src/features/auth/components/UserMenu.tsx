import { Link, useRouter } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/AuthProvider";
import { authClient } from "@/lib/auth-client";

export function UserMenu() {
  const router = useRouter();
  const { user } = useAuth();

  if (!user) return null;

  async function handleSignOut() {
    await authClient.signOut();
    // No navigate here on purpose. Clearing the session updates the router
    // context, and the current route's own guard is what sends us to /login —
    // one owner per direction, or the two redirect each other in a loop.
    await router.invalidate();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={`アカウント: ${user.name || user.email}`}>
            <UserIcon />
            {/*
              The name, because that is what everyone else sees on this user's
              comments. The email is the fallback for an account whose name is
              somehow empty, so the button is never blank.
            */}
            <span className="hidden sm:inline">{user.name || user.email}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link to="/account" />}>
          <SettingsIcon />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
