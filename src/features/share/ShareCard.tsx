import { CheckIcon, CopyIcon, Link2Icon, Link2OffIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { createShareLink, revokeShareLink } from "../share/api";

export function ShareCard({ projectId, token }: { projectId: number; token: string | null }) {
  const [current, setCurrent] = useState(token);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = current ? new URL(`/s/${current}`, window.location.origin).href : null;

  async function enable() {
    setBusy(true);
    const created = await createShareLink(projectId);
    setBusy(false);
    if (created) setCurrent(created);
  }

  async function revoke() {
    setBusy(true);
    const ok = await revokeShareLink(projectId);
    setBusy(false);
    if (!ok) return;

    setCurrent(null);
    setCopied(false);
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>共有リンク</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {current
            ? "リンクを知っている人は誰でも、ログインせずにこのプロジェクトを閲覧できます。編集はできません。"
            : "リンクを発行すると、ログインしていない人でも閲覧できるようになります。"}
        </p>

        {url ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={url} aria-label="共有リンク" className="font-mono text-xs" />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                {copied ? "コピーしました" : "コピー"}
              </Button>
              <Button variant="outline" onClick={() => void revoke()} disabled={busy}>
                <Link2OffIcon className="size-4" />
                解除
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button onClick={() => void enable()} disabled={busy}>
              <Link2Icon className="size-4" />
              共有リンクを発行
            </Button>
          </div>
        )}

        {current && (
          <p className="text-xs text-muted-foreground">
            解除しても、すでに配信済みの内容が最大1分間だけ表示され続けることがあります。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
