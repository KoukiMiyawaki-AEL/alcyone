import { SlidersHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TodoFormProps = {
  /** Resolves to whether the todo was actually created. */
  onAdd: (title: string) => Promise<boolean>;
  /** Opens the full form, carrying whatever has been typed so far. */
  onAddWithDetails: (title: string) => void;
};

/**
 * Two ways in, on purpose.
 *
 * Most tasks are a line of text and nothing else, and making those pass through
 * a dialog would tax the common case to serve the rare one. But a task that
 * *does* have a deadline usually has it at the moment it is written down —
 * "add it now, fill it in later" is how a due date never gets set.
 *
 * So: type and press Enter, or reach for the details without losing the words
 * already typed.
 */
export function TodoForm({ onAdd, onAddWithDetails }: TodoFormProps) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = title.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      // Keep the text on failure so the user can retry without retyping.
      if (await onAdd(trimmed)) setTitle("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="タスクを追加..."
        aria-label="新しいタスクのタイトル"
        disabled={submitting}
      />
      {/*
        Not disabled on an empty title: opening the form with nothing typed is a
        perfectly good way to start, and the form requires a title anyway.
      */}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          onAddWithDetails(title.trim());
          setTitle("");
        }}
        aria-label="詳細を設定して追加"
      >
        <SlidersHorizontalIcon className="size-4" />
        詳細
      </Button>
      <Button type="submit" disabled={submitting || !title.trim()}>
        追加
      </Button>
    </form>
  );
}
