import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProjectFormProps = {
  /** Resolves to whether the project was actually created. */
  onAdd: (name: string) => Promise<boolean>;
};

export function ProjectForm({ onAdd }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = name.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      // Keep the text on failure so the user can retry without retyping.
      if (await onAdd(trimmed)) setName("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Add a project..."
        aria-label="New project name"
        disabled={submitting}
      />
      <Button type="submit" disabled={submitting || !name.trim()}>
        Add Project
      </Button>
    </form>
  );
}
