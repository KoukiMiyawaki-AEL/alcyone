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

  // One entry per revision, plus the standalone comments. A save that changed
  // three fields is one thing that happened, and three lines claiming
  // otherwise is the problem this grouping exists to fix.
  const revisions = new Map<string, { at: string; events: TodoEvent[]; note?: TodoComment }>();
  for (const event of events) {
    const group = revisions.get(event.revisionId);
    if (group) group.events.push(event);
    else revisions.set(event.revisionId, { at: event.createdAt, events: [event] });
  }
  for (const comment of comments) {
    // A comment written *with* a change belongs to that entry. One written on
    // its own is a remark about the task, and stands alone.
    const group = comment.revisionId ? revisions.get(comment.revisionId) : undefined;
    if (group) group.note = comment;
  }

  const entries = [
    ...comments
      .filter((comment) => !comment.revisionId || !revisions.get(comment.revisionId)?.note)
      .map((comment) => ({ kind: "comment" as const, at: comment.createdAt, comment })),
    ...[...revisions.values()].map((group) => ({
      kind: "revision" as const,
      at: group.at,
      group,
    })),
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
        <ol aria-label="アクティビティ" className="flex flex-col gap-3">
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
                      <span className="font-medium text-foreground">
                        {entry.comment.authorName}
                      </span>
                      {" · "}
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
                key={`r${entry.group.events[0]!.revisionId}`}
                className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2"
              >
                <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                  <HistoryIcon className="size-3 shrink-0 self-center" />
                  <ul className="flex flex-col gap-0.5">
                    {entry.group.events.map((event) => (
                      <li key={event.id}>{describe(event)}</li>
                    ))}
                  </ul>
                  {/*
                    Every row in a revision was written by the same person in
                    the same save, so the name belongs to the entry rather than
                    to each line inside it.
                  */}
                  <span className="ml-auto shrink-0">
                    <span className="font-medium text-foreground">
                      {entry.group.events[0]!.actorName}
                    </span>
                    {" · "}
                    <time dateTime={entry.at} className="tabular-nums">
                      {entry.at.slice(0, 16).replace("T", " ")}
                    </time>
                  </span>
                </div>

                {/*
                  The note written with the change, inside the same entry. Read
                  as a separate item it would look like a coincidence of timing
                  rather than the reason for what happened above it.
                */}
                {entry.group.note ? (
                  <p className="border-l-2 border-border pl-2 text-sm whitespace-pre-wrap">
                    {entry.group.note.body}
                  </p>
                ) : null}
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
