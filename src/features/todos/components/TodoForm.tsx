import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TodoFormProps = {
  /** Resolves to whether the todo was actually created. */
  onAdd: (title: string) => Promise<boolean>;
};

export function TodoForm({ onAdd }: TodoFormProps) {
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
        placeholder="Add a task..."
        aria-label="New task title"
        disabled={submitting}
      />
      <Button type="submit" disabled={submitting || !title.trim()}>
        Add Todo
      </Button>
    </form>
  );
}
