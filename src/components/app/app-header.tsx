import { ModeToggle } from "@/components/app/mode-toggle";
import { ProjectSwitcher } from "@/components/app/project-switcher";
import { Separator } from "@/components/ui/separator";
import { UserMenu } from "@/features/auth/components/UserMenu";

export function AppHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-semibold tracking-tight">alcyone</span>
        <Separator orientation="vertical" className="hidden h-5 sm:block" />
        <ProjectSwitcher />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <UserMenu />
        <ModeToggle />
      </div>
    </header>
  );
}
