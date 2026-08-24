import { ModeToggle } from "@/components/app/mode-toggle";
import { UserMenu } from "@/features/auth/components/UserMenu";

export function AppHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
      <span className="text-sm font-semibold tracking-tight">alcyone</span>
      <div className="flex items-center gap-2">
        <UserMenu />
        <ModeToggle />
      </div>
    </header>
  );
}
