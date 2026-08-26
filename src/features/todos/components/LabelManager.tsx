import { PlusIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label as FieldLabel } from "@/components/ui/label";
import { LABEL_COLORS } from "@/worker/db/schema";

import { addLabel, deleteLabel } from "../api";
import type { Label, LabelColor } from "../types";
import { LabelChip, LabelSwatch } from "./LabelChip";

/**
 * A project's labels, on the project's own screen.
 *
 * Not in the task dialog: a label is a decision about the project, and making
 * one while filling in a task means the vocabulary grows one hurried word at a
 * time. Anyone who can work on the tasks can edit this — a label is a way of
 * organising the work, and needing permission to name a category would turn it
 * into administration.
 */
export function LabelManager({
  projectId,
  labels,
  onChanged,
}: {
  projectId: string;
  labels: Label[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("blue");
  const [submitting, setSubmitting] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ラベル</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            まだラベルがありません。ステータスや担当者では表せない区別に使えます。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {labels.map((label) => (
              <li key={label.id} className="flex items-center gap-3">
                <LabelChip label={label} />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`ラベル「${label.name}」を削除`}
                  onClick={async () => {
                    if (await deleteLabel(label.id)) await onChanged();
                  }}
                >
                  <TrashIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          // Named, so it is a landmark rather than an anonymous group: the
          // members card on the same screen has its own 追加 button, and an
          // unnamed form gives a reader no way to tell which one they are in.
          // Not the field's own label — a form and a text box with the same
          // accessible name are two things answering to one word.
          aria-label="新しいラベル"
          className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed === "" || submitting) return;

            setSubmitting(true);
            try {
              // Kept on failure so a rejected name does not have to be retyped.
              if (await addLabel(projectId, { name: trimmed, color })) {
                setName("");
                await onChanged();
              }
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <FieldLabel htmlFor="new-label-name">ラベルを追加</FieldLabel>
            <Input
              id="new-label-name"
              value={name}
              maxLength={60}
              placeholder="要調査 / リリース待ち など"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {/*
            Swatches rather than a select: six options fit, and picking a colour
            from a list of colour *names* is a needless translation.
          */}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm leading-none font-medium">色</legend>
            <div className="flex gap-1 pt-1">
              {LABEL_COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`色: ${value}`}
                  aria-pressed={color === value}
                  onClick={() => setColor(value)}
                  className={`flex size-8 items-center justify-center rounded-md border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
                    color === value ? "border-ring" : "border-transparent"
                  }`}
                >
                  <LabelSwatch color={value} />
                </button>
              ))}
            </div>
          </fieldset>

          <Button type="submit" disabled={name.trim() === "" || submitting}>
            <PlusIcon className="size-4" />
            追加
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
