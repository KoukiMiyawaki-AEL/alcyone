import { Link, Outlet, createRootRouteWithContext, useRouter } from "@tanstack/react-router";
import { FileQuestionIcon, TriangleAlertIcon } from "lucide-react";

import { AppHeader } from "@/components/app/app-header";
import { AppSidebar } from "@/components/app/app-sidebar";
import { EmptyState } from "@/components/app/empty-state";
import { ThemeProvider } from "@/components/app/theme-provider";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AuthState } from "@/features/auth/types";

export const Route = createRootRouteWithContext<{ auth: AuthState }>()({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFoundComponent,
});

function RootComponent() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="alcyone-ui-theme">
      <TooltipProvider>
        <div className="flex h-svh flex-col bg-background text-foreground">
          <AppHeader />
          <div className="flex flex-1 overflow-hidden">
            <AppSidebar />
            <main className="flex-1 overflow-y-auto p-4 sm:p-6">
              <Outlet />
            </main>
          </div>
        </div>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

function RootErrorComponent({ error }: { error: Error }) {
  const router = useRouter();

  return (
    <EmptyState
      icon={TriangleAlertIcon}
      title="Something went wrong"
      description={error.message}
      action={
        <Button size="sm" variant="outline" onClick={() => router.invalidate()}>
          Retry
        </Button>
      }
    />
  );
}

function RootNotFoundComponent() {
  return (
    <EmptyState
      icon={FileQuestionIcon}
      title="Page not found"
      description="お探しのページは存在しません。"
      action={
        <Button size="sm" variant="outline" render={<Link to="/" />}>
          Go to Projects
        </Button>
      }
    />
  );
}
