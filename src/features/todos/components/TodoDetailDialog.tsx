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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TODO_STATUSES } from "@/worker/db/schema";

import { PRIORITY_LABELS, STATUS_LABELS, type Todo, type TodoFields } from "../types";

type TodoDetailDialogProps = {
  todo: Todo | null;
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, fields: TodoFields) => Promise<boolean>;
};

/** An empty date input reads as "", which the API expects as `null`. */
const orNull = (value: string) => (value.trim() === "" ? null : value);

/**
 * Edits everything a todo carries.
 *
 * Sends the whole form rather than a diff. The dialog is the only writer while
 * it is open and the fields are few, so a diff would add a way to be wrong
 * without saving a round trip.
 */
export function TodoDetailDialog({ todo, onOpenChange, onSave }: TodoDetailDialogProps) {
  return (
    <Dialog open={todo !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/*
          Keyed by the todo, so opening a different one remounts the form with
          that row's values. Copying props into state inside an effect would do
          the same thing one render later, and would also overwrite whatever the
          user had typed the next time the list refetched.
        */}
        {todo ? (
          <TodoDetailForm key={todo.id} todo={todo} onOpenChange={onOpenChange} onSave={onSave} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TodoDetailForm({
  todo,
  onOpenChange,
  onSave,
}: {
  todo: Todo;
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, fields: TodoFields) => Promise<boolean>;
}) {
  const formId = useId();
  const [fields, setFields] = useState<TodoFields>({
    title: todo.title,
    status: todo.status,
    startAt: todo.startAt,
    dueAt: todo.dueAt,
    description: todo.description,
    priority: todo.priority,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    // Checked here as well as on the server: the server owns the rule, but
    // finding out after a round trip is a worse way to learn it.
    if (fields.startAt && fields.dueAt && fields.startAt > fields.dueAt) {
      setError("開始日は期限日より後にできません。");
      return;
    }

    setSaving(true);
    const saved = await onSave(todo.id, fields);
    setSaving(false);
    if (saved) onOpenChange(false);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>タスクの詳細</DialogTitle>
        <DialogDescription>
          ステータス・期間・メモを設定します。空欄にすると未設定になります。
        </DialogDescription>
      </DialogHeader>

      <form id={formId} className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-title`}>タイトル</Label>
          <Input
            id={`${formId}-title`}
            value={fields.title ?? ""}
            onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
            required
            maxLength={200}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-status`}>ステータス</Label>
            <Select
              items={TODO_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
              value={fields.status ?? "todo"}
              onValueChange={(value) =>
                setFields((f) => ({ ...f, status: value as Todo["status"] }))
              }
            >
              <SelectTrigger id={`${formId}-status`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TODO_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-priority`}>優先度</Label>
            <Select
              items={PRIORITY_LABELS.map((label, value) => ({ value, label }))}
              value={fields.priority ?? 0}
              onValueChange={(value) => setFields((f) => ({ ...f, priority: Number(value) }))}
            >
              <SelectTrigger id={`${formId}-priority`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_LABELS.map((label, value) => (
                  <SelectItem key={label} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-start`}>開始日</Label>
            <Input
              id={`${formId}-start`}
              type="date"
              value={fields.startAt ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, startAt: orNull(e.target.value) }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-due`}>期限日</Label>
            <Input
              id={`${formId}-due`}
              type="date"
              value={fields.dueAt ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, dueAt: orNull(e.target.value) }))}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-description`}>メモ</Label>
          <Textarea
            id={`${formId}-description`}
            rows={4}
            maxLength={2000}
            value={fields.description ?? ""}
            onChange={(e) => setFields((f) => ({ ...f, description: orNull(e.target.value) }))}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>

      <DialogFooter>
        <DialogClose render={<Button variant="outline">キャンセル</Button>} />
        <Button type="submit" form={formId} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </>
  );
}
