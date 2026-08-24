import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TodoActivity } from "@/features/todos/components/TodoActivity";
import type { TodoComment, TodoEvent } from "@/features/todos/types";

const comment = (over: Partial<TodoComment> = {}): TodoComment => ({
  id: 1,
  todoId: 1,
  authorId: "u1",
  body: "コメント本文",
  createdAt: "2026-08-24T10:00:00.000Z",
  updatedAt: "2026-08-24T10:00:00.000Z",
  deletedAt: null,
  ...over,
});

const event = (over: Partial<TodoEvent> = {}): TodoEvent => ({
  id: 1,
  todoId: 1,
  actorId: "u1",
  field: "created",
  fromValue: null,
  toValue: null,
  createdAt: "2026-08-24T09:00:00.000Z",
  ...over,
});

function renderActivity(props: Partial<Parameters<typeof TodoActivity>[0]> = {}) {
  return render(
    <TodoActivity
      comments={[]}
      events={[]}
      loading={false}
      onAdd={vi.fn().mockResolvedValue(true)}
      onEdit={vi.fn().mockResolvedValue(true)}
      onRemove={vi.fn().mockResolvedValue(true)}
      {...props}
    />,
  );
}

describe("TodoActivity", () => {
  it("interleaves comments and history by time", () => {
    // Split into two lists, the reader has to do the merging — and a comment
    // usually explains the change immediately above or below it.
    renderActivity({
      comments: [comment({ id: 1, body: "二番目", createdAt: "2026-08-24T10:00:00.000Z" })],
      events: [
        event({ id: 1, field: "created", createdAt: "2026-08-24T09:00:00.000Z" }),
        event({
          id: 2,
          field: "status",
          fromValue: "todo",
          toValue: "done",
          createdAt: "2026-08-24T11:00:00.000Z",
        }),
      ],
    });

    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("作成");
    expect(items[1]).toContain("二番目");
    expect(items[2]).toContain("ステータス");
  });

  it("reads stored values back in the words the rest of the UI uses", () => {
    renderActivity({
      events: [event({ id: 1, field: "status", fromValue: "todo", toValue: "in_progress" })],
    });

    expect(screen.getByText(/未着手 → 進行中/)).toBeInTheDocument();
  });

  it("shows a cleared value as a dash rather than as nothing", () => {
    // An empty string reads as a rendering bug; "—" says a value was removed.
    renderActivity({
      events: [event({ id: 1, field: "dueAt", fromValue: "2026-12-01", toValue: null })],
    });

    expect(screen.getByText(/2026-12-01 → —/)).toBeInTheDocument();
  });

  it("marks a comment that was edited", () => {
    renderActivity({
      comments: [
        comment({ createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z" }),
      ],
    });

    expect(screen.getByText(/編集済み/)).toBeInTheDocument();
  });

  it("does not mark a comment that was never edited", () => {
    renderActivity({ comments: [comment()] });

    expect(screen.queryByText(/編集済み/)).not.toBeInTheDocument();
  });

  it("posts a comment and clears the box on success", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(true);
    renderActivity({ onAdd });

    const box = screen.getByLabelText("コメント");
    await user.type(box, "  書いた  ");
    await user.click(screen.getByRole("button", { name: "コメントする" }));

    expect(onAdd).toHaveBeenCalledExactlyOnceWith("書いた");
    expect(box).toHaveValue("");
  });

  it("keeps what was written when the post fails", async () => {
    const user = userEvent.setup();
    renderActivity({ onAdd: vi.fn().mockResolvedValue(false) });

    const box = screen.getByLabelText("コメント");
    await user.type(box, "失敗する");
    await user.click(screen.getByRole("button", { name: "コメントする" }));

    expect(box).toHaveValue("失敗する");
  });

  it("refuses to post an empty comment", async () => {
    const user = userEvent.setup();
    renderActivity();

    expect(screen.getByRole("button", { name: "コメントする" })).toBeDisabled();
    await user.type(screen.getByLabelText("コメント"), "   ");
    expect(screen.getByRole("button", { name: "コメントする" })).toBeDisabled();
  });

  it("edits a comment in place", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(true);
    renderActivity({ comments: [comment({ id: 5, body: "まちがい" })], onEdit });

    await user.click(screen.getByRole("button", { name: "コメントを編集" }));
    const box = screen.getByLabelText("コメントを編集");
    await user.clear(box);
    await user.type(box, "なおした");
    await user.click(screen.getByRole("button", { name: "更新" }));

    expect(onEdit).toHaveBeenCalledExactlyOnceWith(5, "なおした");
  });

  it("offers no way to edit a history row", () => {
    // The only property an audit trail has is that it cannot be rewritten. If
    // the UI ever grows a pencil next to one, this notices.
    renderActivity({
      events: [event({ id: 1, field: "status", fromValue: "todo", toValue: "done" })],
    });

    expect(screen.queryByRole("button", { name: "コメントを編集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "コメントを削除" })).not.toBeInTheDocument();
  });

  it("says when there is nothing yet, and when it is still loading", () => {
    const { rerender } = renderActivity({ loading: true });
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();

    rerender(
      <TodoActivity
        comments={[]}
        events={[]}
        loading={false}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("まだ何もありません。")).toBeInTheDocument();
  });
});
