import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { ShieldIcon, TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthProvider";
import { setUserRole } from "@/features/users/api";
import type { Account } from "@/features/users/types";
import { apiClient } from "@/lib/api-client";

const TRANSIENT = "ユーザー一覧を取得できませんでした。";

type LoaderData = { accounts: Account[]; error: string | null };

export const Route = createFileRoute("/admin")({
  beforeLoad: ({ context, location }) => {
    if (context.auth.isPending) return;
    if (!context.auth.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  loader: async (): Promise<LoaderData> => {
    let res;
    try {
      res = await apiClient.api.users.$get();
    } catch {
      return { accounts: [], error: TRANSIENT };
    }

    if (res.status === 401) throw redirect({ to: "/login", search: { redirect: "/admin" } });
    if (!res.ok) return { accounts: [], error: TRANSIENT };

    return { accounts: (await res.json()) as Account[], error: null };
  },
  component: AdminComponent,
});

function AdminComponent() {
  const router = useRouter();
  const { user } = useAuth();
  const { accounts, error } = Route.useLoaderData();

  // Read from `useAuth`, not from the route context, and rendered rather than
  // redirected. The context only updates when matches re-resolve, so a member
  // who typed this URL kept the page a `beforeLoad` check would have bounced —
  // the session had not arrived yet the one time that check ran. This is not
  // the permission either way; the server answers a member with an empty list.
  if (user && user.role !== "admin") {
    return (
      <EmptyState
        icon={ShieldIcon}
        title="権限がありません"
        description="ユーザー管理を開けるのは管理者だけです。"
        action={
          <Button size="sm" variant="outline" render={<Link to="/" />}>
            プロジェクトへ戻る
          </Button>
        }
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={TriangleAlertIcon}
        title="Something went wrong"
        description={error}
        action={
          <Button size="sm" variant="outline" onClick={() => router.invalidate()}>
            Retry
          </Button>
        }
      />
    );
  }

  const admins = accounts.filter((account) => account.role === "admin").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ユーザー管理"
        description="管理者はすべてのプロジェクトの参加者を変更できます"
      />

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {accounts.map((account) => {
              const isAdmin = account.role === "admin";
              // The server refuses this too; disabling it here is so the reason
              // is visible before the click rather than as a failed request.
              const lastAdmin = isAdmin && admins === 1;

              return (
                <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{account.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{account.email}</span>
                  </div>

                  {isAdmin ? (
                    <Badge variant="secondary">
                      <ShieldIcon className="size-3" />
                      管理者
                    </Badge>
                  ) : (
                    <Badge variant="outline">一般</Badge>
                  )}
                  {account.id === user?.id ? (
                    <span className="text-xs text-muted-foreground">あなた</span>
                  ) : null}

                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={lastAdmin}
                    onClick={async () => {
                      if (await setUserRole(account.id, isAdmin ? "member" : "admin")) {
                        await router.invalidate();
                      }
                    }}
                  >
                    {isAdmin ? "管理者を解除" : "管理者にする"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        最後の管理者は解除できません。権限を渡せるのは管理者だけなので、ひとりもいない状態からは
        戻れなくなるためです。最初に作られたアカウントが自動的に管理者になります。
      </p>
    </div>
  );
}
