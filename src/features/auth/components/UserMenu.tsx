import { Link } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/AuthProvider";
import { endSession } from "@/features/auth/session-exit";

export function UserMenu() {
  const { user } = useAuth();

  if (!user) return null;

  async function handleSignOut() {
    // One exit, and it throws the page away — see endSession for why clearing
    // caches by hand is a weaker guarantee than not having a page any more.
    await endSession();
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
