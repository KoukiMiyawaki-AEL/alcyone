import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { TriangleAlertIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthProvider";
import { createAccount, setUserRole } from "@/features/users/api";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Account,
  type UserRole,
} from "@/features/users/types";
import { apiClient } from "@/lib/api-client";

const TRANSIENT = "ユーザー一覧を取得できませんでした。";
const PASSWORD_FLOOR = 12;

type LoaderData = { accounts: Account[]; error: string | null };

export const Route = createFileRoute("/admin")({
  staticData: { access: "admin" },
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

  // The gate has already refused anyone below `admin`, so the only question
  // left here is whether this administrator is also the system owner.
  const role = (user?.role ?? "member") as UserRole;

  // An owner may hand out any role. An administrator may not create anyone at
  // or above their own rank — the server refuses either way, and this keeps the
  // option out of the list rather than letting it fail on submit.
  const grantable: UserRole[] =
    role === "owner" ? ["member", "admin", "owner"] : ["member", "admin"];
  const owners = accounts.filter((account) => account.role === "owner").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ユーザー管理" description="アカウントの追加と、権限の割り当て" />

      <NewAccountCard
        grantable={grantable}
        onCreated={async () => {
          await router.invalidate();
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>アカウント</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {accounts.map((account) => {
              // The server refuses these too; disabling them here is so the
              // reason is visible before the click rather than as a failure.
              const lastOwner = account.role === "owner" && owners === 1;
              const outranked = role !== "owner" && account.role === "owner";

              return (
                <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{account.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{account.email}</span>
                  </div>

                  {account.id === user?.id ? <Badge variant="secondary">あなた</Badge> : null}

                  <div className="ml-auto flex items-center gap-2">
                    {lastOwner || outranked ? (
                      <Badge variant="outline">{ROLE_LABELS[account.role]}</Badge>
                    ) : (
                      <Select
                        items={grantable.map((value) => ({ value, label: ROLE_LABELS[value] }))}
                        value={account.role}
                        onValueChange={async (value) => {
                          if (await setUserRole(account.id, value as UserRole)) {
                            await router.invalidate();
                          }
                        }}
                      >
                        <SelectTrigger className="w-36" aria-label={`${account.name} の権限`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {grantable.map((value) => (
                            <SelectItem key={value} value={value}>
                              {ROLE_LABELS[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <dl className="flex flex-col gap-2 text-sm">
        {(["owner", "admin", "member"] as const).map((value) => (
          <div key={value} className="flex flex-wrap gap-2">
            <dt className="w-20 shrink-0 font-medium">{ROLE_LABELS[value]}</dt>
            <dd className="flex-1 text-muted-foreground">{ROLE_DESCRIPTIONS[value]}</dd>
          </div>
        ))}
      </dl>

      <p className="text-sm text-muted-foreground">
        最後のオーナーは変更できません。オーナーを任命できるのはオーナーだけなので、
        ひとりもいない状態からは戻れなくなるためです。最初に作られたアカウントが
        自動的にオーナーになります。
      </p>
    </div>
  );
}

function NewAccountCard({
  grantable,
  onCreated,
}: {
  grantable: UserRole[];
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [submitting, setSubmitting] = useState(false);

  const ready = name.trim() !== "" && email.trim() !== "" && password.length >= PASSWORD_FLOOR;

  return (
    <Card>
      <CardHeader>
        <CardTitle>アカウントを追加</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!ready || submitting) return;

            setSubmitting(true);
            try {
              const created = await createAccount({
                name: name.trim(),
                email: email.trim(),
                password,
                role,
              });
              // Kept on failure so the address does not have to be retyped;
              // cleared on success so the next one starts empty.
              if (created) {
                setName("");
                setEmail("");
                setPassword("");
                setRole("member");
                await onCreated();
              }
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-account-name">名前</Label>
            <Input
              id="new-account-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-account-email">メールアドレス</Label>
            <Input
              id="new-account-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-account-password">初期パスワード</Label>
            <Input
              id="new-account-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {PASSWORD_FLOOR}文字以上。本人に伝えて、変更してもらってください。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-account-role">権限</Label>
            <Select
              items={grantable.map((value) => ({ value, label: ROLE_LABELS[value] }))}
              value={role}
              onValueChange={(value) => setRole(value as UserRole)}
            >
              <SelectTrigger id="new-account-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {grantable.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={!ready || submitting}>
              <UserPlusIcon className="size-4" />
              追加
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
