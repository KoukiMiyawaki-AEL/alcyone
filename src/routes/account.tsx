import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/AuthProvider";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/account")({
  beforeLoad: ({ context, location }) => {
    if (context.auth.isPending) return;
    if (!context.auth.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AccountComponent,
});

function AccountComponent() {
  const router = useRouter();
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
      // The session is gone, so the guards take it from here.
      await router.invalidate();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader title="Account" description={user?.email ?? ""} />

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
