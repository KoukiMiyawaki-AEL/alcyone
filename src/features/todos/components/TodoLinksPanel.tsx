import { LinkIcon, TrashIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { TODO_LINK_KINDS, type TodoLinkKind } from "@/worker/db/schema";

import { addLink, removeLink } from "../api";
import type { Todo } from "../types";

type Link = { id: number; kind: TodoLinkKind; fromTodoId: number; toTodoId: number };

/** Read from this task's side, so "blocks" and "blocked by" are distinguishable. */
const LINK_LABELS: Record<string, string> = {
  "blocks:out": "ブロックしている",
  "blocks:in": "ブロックされている",
  "related:out": "関連",
  "related:in": "関連",
};

/**
 * The links a task has, and a way to add one.
 *
 * Fetched here rather than by the route's loader for the same reason the
 * activity panel is: it is only visible inside the dialog, and loading it with
 * the list would make every row of every project pay for a panel almost nobody
 * opens.
 */
export function TodoLinksPanel({ todo, candidates }: { todo: Todo; candidates: Todo[] }) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [kind, setKind] = useState<TodoLinkKind>("related");
  const [target, setTarget] = useState<string>("");

  async function load() {
    try {
      const res = await apiClient.api.todos[":id"].links.$get({ param: { id: String(todo.id) } });
      setLinks(res.ok ? ((await res.json()) as Link[]) : []);
    } catch {
      // An empty panel is the right failure: the dialog's job is editing the
      // task, and a broken link list must not take that with it.
      setLinks([]);
    }
  }

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const res = await apiClient.api.todos[":id"].links.$get({ param: { id: String(todo.id) } });
        const next = res.ok ? ((await res.json()) as Link[]) : [];
        if (current) setLinks(next);
      } catch {
        if (current) setLinks([]);
      }
    })();
    return () => {
      current = false;
    };
  }, [todo.id]);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  // Everything except this task and its own children, which are the hierarchy
  // rather than a link.
  const selectable = candidates.filter((c) => c.id !== todo.id && c.parentId !== todo.id);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`link-target-${todo.id}`}>関連づけるタスク</Label>
          <Select
            items={selectable.map((c) => ({ value: String(c.id), label: c.title }))}
            value={target}
            onValueChange={(value) => setTarget(String(value))}
          >
            <SelectTrigger id={`link-target-${todo.id}`} className="w-full">
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              {selectable.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`link-kind-${todo.id}`}>種類</Label>
          <Select
            items={TODO_LINK_KINDS.map((k) => ({ value: k, label: LINK_LABELS[`${k}:out`]! }))}
            value={kind}
            onValueChange={(value) => setKind(value as TodoLinkKind)}
          >
            <SelectTrigger id={`link-kind-${todo.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TODO_LINK_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {LINK_LABELS[`${k}:out`]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={target === ""}
          onClick={async () => {
            if (await addLink(todo.id, Number(target), kind)) {
              setTarget("");
              await load();
            }
          }}
        >
          <LinkIcon className="size-4" />
          追加
        </Button>
      </div>

      {links === null ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">関連づけられたタスクはありません。</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((link) => {
            // Which end this task is on decides how the link reads.
            const outgoing = link.fromTodoId === todo.id;
            const otherId = outgoing ? link.toTodoId : link.fromTodoId;
            return (
              <li key={link.id} className="flex items-center gap-2 text-sm">
                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {LINK_LABELS[`${link.kind}:${outgoing ? "out" : "in"}`]}
                </span>
                <span className="truncate">{byId.get(otherId)?.title ?? `#${otherId}`}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label="関連づけを解除"
                  onClick={async () => {
                    if (await removeLink(link.id)) await load();
                  }}
                >
                  <TrashIcon className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
