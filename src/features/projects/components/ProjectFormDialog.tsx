import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LabelSwatch } from "@/features/todos/components/LabelChip";
import { LABEL_COLORS } from "@/worker/db/schema";

import { suggestKey, type Project, type ProjectInput } from "../types";

export type ProjectEditor = { mode: "create" } | { mode: "edit"; project: Project };

type Values = ProjectInput & { name: string; key: string };

/**
 * Creating and editing a project, on one form.
 *
 * A dialog rather than the single-field box this replaces, for the reason ADR
 * 0030 moved task creation into one: a project is worth naming, describing and
 * scheduling, and a screen that only asks for a name teaches everyone that
 * those other fields do not exist.
 */
export function ProjectFormDialog({
  editor,
  onOpenChange,
  onSave,
}: {
  editor: ProjectEditor | null;
  onOpenChange: (open: boolean) => void;
  onSave: (values: Values, project: Project | null) => Promise<boolean>;
}) {
  return (
    <Dialog open={editor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {/*
          Keyed, so opening a different project remounts the form with that
          project's values. Copying props into state inside an effect would do
          the same thing one render later, and would also overwrite whatever
          had been typed the next time the list refetched.
        */}
        {editor ? (
          <ProjectForm
            key={editor.mode === "edit" ? `edit-${editor.project.id}` : "create"}
            editor={editor}
            onOpenChange={onOpenChange}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  editor,
  onOpenChange,
  onSave,
}: {
  editor: ProjectEditor;
  onOpenChange: (open: boolean) => void;
  onSave: (values: Values, project: Project | null) => Promise<boolean>;
}) {
  const formId = useId();
  const creating = editor.mode === "create";

  const [name, setName] = useState(creating ? "" : editor.project.name);
  /** Set once somebody types their own key; until then it follows the name. */
  const [typedKey, setTypedKey] = useState<string | null>(creating ? null : editor.project.key);
  const [description, setDescription] = useState(
    creating ? "" : (editor.project.description ?? ""),
  );
  const [color, setColor] = useState(creating ? "slate" : editor.project.color);
  const [startAt, setStartAt] = useState(creating ? "" : (editor.project.startAt ?? ""));
  const [dueAt, setDueAt] = useState(creating ? "" : (editor.project.dueAt ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Derived during render rather than synced in an effect: the key follows the
  // name until somebody types their own, which is a value, not a subscription.
  // A suggestion and not a rule — a Japanese name produces nothing here, and
  // "Design system" produces DESIGNSYST, which nobody would have chosen.
  const key = typedKey ?? suggestKey(name);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (startAt && dueAt && startAt > dueAt) {
      setError("開始日は終了日より後にできません。");
      return;
    }
    if (!/^[A-Z0-9_]{1,10}$/.test(key)) {
      setError("プロジェクトキーは英大文字・数字・アンダースコア、10文字までです。");
      return;
    }

    setSaving(true);
    const saved = await onSave(
      {
        name: name.trim(),
        key,
        description: description.trim() === "" ? null : description.trim(),
        color,
        startAt: startAt === "" ? null : startAt,
        dueAt: dueAt === "" ? null : dueAt,
      },
      creating ? null : editor.project,
    );
    setSaving(false);
    if (saved) onOpenChange(false);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{creating ? "プロジェクトを追加" : "プロジェクトの設定"}</DialogTitle>
        <DialogDescription>
          名前・キー・説明・期間を設定します。空欄にすると未設定になります。
        </DialogDescription>
      </DialogHeader>

      <form id={formId} className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-name`}>プロジェクト名</Label>
          <Input
            id={`${formId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-key`}>プロジェクトキー</Label>
          <Input
            id={`${formId}-key`}
            value={key}
            // Read-only once it exists. Jira refuses to change a key after a
            // project has issues and Backlog advises against it, both because
            // the key is in every reference anyone has written down.
            disabled={!creating}
            onChange={(event) =>
              setTypedKey(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9_]/g, "")
                  .slice(0, 10),
              )
            }
            maxLength={10}
          />
          <p className="text-xs text-muted-foreground">
            {creating
              ? `タスクは ${key || "KEY"}-12 のように表示されます。あとから変更できません。`
              : "作成後は変更できません。"}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-description`}>説明</Label>
          <Textarea
            id={`${formId}-description`}
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-start`}>開始日</Label>
            <Input
              id={`${formId}-start`}
              type="date"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-due`}>終了日</Label>
            <Input
              id={`${formId}-due`}
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>

      <DialogFooter>
        <DialogClose render={<Button variant="outline">キャンセル</Button>} />
        <Button type="submit" form={formId} disabled={saving || name.trim() === ""}>
          {creating ? "追加" : "保存"}
        </Button>
      </DialogFooter>
    </>
  );
}
