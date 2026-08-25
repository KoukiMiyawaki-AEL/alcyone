import { CheckIcon, CopyIcon, Link2Icon, Link2OffIcon, Share2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { createShareLink, revokeShareLink } from "../share/api";

/**
 * Sharing, behind a button.
 *
 * It used to be a card on the page, permanently occupying the space above the
 * tasks to say something that is true once and then irrelevant — most visits
 * to a project are not about sharing it. The button keeps it one click away
 * without letting it charge rent for that.
 */
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
    <Dialog>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Share2Icon className="size-4" />
            {/*
              The state is worth showing on the trigger: whether a project is
              public is exactly the kind of thing you should not have to open a
              dialog to find out.
            */}
            {current ? "共有中" : "共有"}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>共有リンク</DialogTitle>
          <DialogDescription>
            {current
              ? "リンクを知っている人は誰でも、ログインせずにこのプロジェクトを閲覧できます。編集はできません。"
              : "リンクを発行すると、ログインしていない人でも閲覧できるようになります。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {url ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                value={url}
                aria-label="共有リンクのURL"
                className="font-mono text-xs"
              />
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

          {current ? (
            <p className="text-xs text-muted-foreground">
              解除しても、すでに配信済みの内容が最大1分間だけ表示され続けることがあります。
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
