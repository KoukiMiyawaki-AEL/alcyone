import { HistoryIcon, MessageSquareIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import {
  EVENT_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TodoComment,
  type TodoEvent,
} from "../types";

type TodoActivityProps = {
  comments: TodoComment[];
  events: TodoEvent[];
  loading: boolean;
  onAdd: (body: string) => Promise<boolean>;
  onEdit: (id: number, body: string) => Promise<boolean>;
  onRemove: (id: number) => Promise<boolean>;
};

/**
 * What was said about a task, and what happened to it, in one column.
 *
 * Interleaved by time because that is how the story reads: a comment usually
 * explains the change just above or below it, and splitting them into two lists
 * makes the reader do the merging.
 *
 * The two kinds stay visibly different — history rows are not editable and
 * never look like they might be.
 */
export function TodoActivity({
  comments,
  events,
  loading,
  onAdd,
  onEdit,
  onRemove,
}: TodoActivityProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);

  const entries = [
    ...comments.map((comment) => ({ kind: "comment" as const, at: comment.createdAt, comment })),
    ...events.map((event) => ({ kind: "event" as const, at: event.createdAt, event })),
    // Ties broken by kind so an ordering never flips between renders; both
    // carry second-resolution timestamps, and a change plus the comment about
    // it land in the same second often enough to matter.
  ].sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;

    setBusy(true);
    // Cleared only on success, so a failed post does not lose what was written.
    if (await onAdd(body)) setDraft("");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="コメントを書く..."
          aria-label="コメント"
          rows={3}
          maxLength={4000}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy || draft.trim() === ""}>
            <MessageSquareIcon className="size-4" />
            コメントする
          </Button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ何もありません。</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) =>
            entry.kind === "comment" ? (
              <li key={`c${entry.comment.id}`} className="rounded-md border border-border p-3">
                {editing?.id === entry.comment.id ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const body = editing.body.trim();
                      if (!body) return;
                      if (await onEdit(entry.comment.id, body)) setEditing(null);
                    }}
                  >
                    <Textarea
                      value={editing.body}
                      onChange={(e) => setEditing({ id: entry.comment.id, body: e.target.value })}
                      aria-label="コメントを編集"
                      rows={3}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(null)}
                      >
                        キャンセル
                      </Button>
                      <Button type="submit" size="sm">
                        更新
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      {/* `whitespace-pre-wrap` so line breaks someone typed survive. */}
                      <p className="text-sm whitespace-pre-wrap">{entry.comment.body}</p>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="コメントを編集"
                          onClick={() =>
                            setEditing({ id: entry.comment.id, body: entry.comment.body })
                          }
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="コメントを削除"
                          onClick={() => void onRemove(entry.comment.id)}
                        >
                          <TrashIcon className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <time dateTime={entry.comment.createdAt}>
                        {entry.comment.createdAt.slice(0, 16).replace("T", " ")}
                      </time>
                      {entry.comment.updatedAt !== entry.comment.createdAt ? "（編集済み）" : null}
                    </p>
                  </>
                )}
              </li>
            ) : (
              <li
                key={`e${entry.event.id}`}
                className="flex items-baseline gap-2 px-1 text-xs text-muted-foreground"
              >
                <HistoryIcon className="size-3 shrink-0 self-center" />
                <span>{describe(entry.event)}</span>
                <time dateTime={entry.event.createdAt} className="ml-auto shrink-0 tabular-nums">
                  {entry.event.createdAt.slice(0, 16).replace("T", " ")}
                </time>
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}

/** Renders stored values back into the words the UI uses elsewhere. */
function describe(event: TodoEvent): string {
  const label = EVENT_LABELS[event.field];

  if (event.field === "created" || event.field === "deleted" || event.field === "restored") {
    return label;
  }

  return `${label}: ${valueOf(event.field, event.fromValue)} → ${valueOf(event.field, event.toValue)}`;
}

function valueOf(field: TodoEvent["field"], value: string | null): string {
  // A cleared field is not an empty string on screen: "—" says a value was
  // removed, where "" reads as a rendering bug.
  if (value === null) return "—";
  if (field === "status") return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value;
  if (field === "priority") return PRIORITY_LABELS[Number(value)] ?? value;
  return value;
}
