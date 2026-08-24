import { Link } from "@tanstack/react-router";
import { FolderIcon, PaletteIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Projects", icon: FolderIcon },
  { to: "/dev/design-system", label: "Design System", icon: PaletteIcon },
] as const;

export function AppSidebar() {
  return (
    <nav className="hidden w-56 shrink-0 border-r border-border p-3 sm:block">
      <ul className="flex flex-col gap-1">
        {navItems.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              )}
              activeProps={{
                className: "bg-accent text-accent-foreground",
              }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
