import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/AuthProvider";
import { ProfileCard } from "@/features/auth/components/ProfileCard";
import { endSession } from "@/features/auth/session-exit";
import { DataExportCard } from "@/features/exports/DataExportCard";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/account")({
  component: AccountComponent,
});

function AccountComponent() {
  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const { error: deleteError } = await authClient.deleteUser({ password });
      if (deleteError) {
        setError(deleteError.message ?? "アカウントの削除に失敗しました。");
        return;
      }
      // Navigating explicitly, unlike sign-out. Route guards only run on
      // navigation, and deleting your account leaves you standing on /account
      // with nothing to trigger one — so there is no guard to defer to here.
      // This cannot loop the way the login screen once did: /login has no
      // guard of its own to push back.
      //
      // The same exit as signing out. The rows are gone, but nothing on screen
      // knows that yet — a row disappearing does not erase the copy of it this
      // page is holding, which is the whole reason the exit is a hard one.
      await endSession();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader title="Account" description={user?.email ?? ""} />

      {user ? <ProfileCard name={user.name} email={user.email} /> : null}

      <DataExportCard />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">アカウントを削除</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            アカウントと、所有しているすべてのプロジェクト・タスクを完全に削除します。
            <strong className="text-foreground">
              削除済みのタスクも含めて消え、元に戻すことはできません。
            </strong>
          </p>

          {confirming ? (
            <form onSubmit={handleDelete} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">確認のためパスワードを入力</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={submitting}
                />
              </div>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-2">
                <Button type="submit" variant="destructive" disabled={submitting}>
                  完全に削除する
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => {
                    setConfirming(false);
                    setPassword("");
                    setError(null);
                  }}
                >
                  キャンセル
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="destructive"
              className="self-start"
              onClick={() => setConfirming(true)}
            >
              アカウントを削除
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
