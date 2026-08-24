import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

/**
 * The display name, which is what everyone else sees.
 *
 * It was collected at sign-up and then unchangeable, which is a strange thing
 * to do with the one field that identifies a person to everyone else. It
 * appears on every comment and every change now, so being able to correct it
 * matters more than it did.
 *
 * The email stays read-only: changing it is an identity change, needs the
 * address proved, and there is no mail infrastructure (ADR 0013).
 */
export function ProfileCard({ name, email }: { name: string; email: string }) {
  const fieldId = useId();
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);

  const trimmed = value.trim();
  const unchanged = trimmed === name;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || trimmed === "" || unchanged) return;

    setSaving(true);
    // Better Auth owns the user table, so this goes through its endpoint
    // rather than a handler of ours writing to a table we do not own.
    const { error } = await authClient.updateUser({ name: trimmed });
    setSaving(false);

    if (error) {
      toast.add({ type: "error", title: "名前を変更できませんでした。" });
      return;
    }
    toast.add({ type: "success", title: "名前を変更しました。" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>プロフィール</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
          <Label htmlFor={`${fieldId}-name`}>表示名</Label>
          <div className="flex gap-2">
            <Input
              id={`${fieldId}-name`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={100}
              required
            />
            <Button type="submit" disabled={saving || trimmed === "" || unchanged}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">コメントや変更履歴に表示されます。</p>
        </form>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${fieldId}-email`}>メールアドレス</Label>
          <Input id={`${fieldId}-email`} value={email} readOnly disabled />
          <p className="text-xs text-muted-foreground">メールアドレスは変更できません。</p>
        </div>
      </CardContent>
    </Card>
  );
}
