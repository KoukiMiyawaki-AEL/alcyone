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
  authorName: "Alice",
  revisionId: null,
  createdAt: "2026-08-24T10:00:00.000Z",
  updatedAt: "2026-08-24T10:00:00.000Z",
  ...over,
});

const event = (over: Partial<TodoEvent> = {}): TodoEvent => ({
  id: 1,
  todoId: 1,
  actorId: "u1",
  actorName: "Alice",
  revisionId: "r1",
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
        event({ id: 1, revisionId: "r1", field: "created", createdAt: "2026-08-24T09:00:00.000Z" }),
        event({
          id: 2,
          revisionId: "r2",
          field: "status",
          fromValue: "todo",
          toValue: "done",
          createdAt: "2026-08-24T11:00:00.000Z",
        }),
      ],
    });

    // Asserted on the order of the text rather than on item indices: a
    // revision renders its changes as a nested list, so counting list items
    // would be counting the markup instead of the story.
    const feed = screen.getByRole("list", { name: "アクティビティ" }).textContent ?? "";
    expect(feed.indexOf("作成")).toBeLessThan(feed.indexOf("二番目"));
    expect(feed.indexOf("二番目")).toBeLessThan(feed.indexOf("ステータス"));
  });

  it("shows one save as one entry, however many fields it changed", () => {
    // The form submits everything at once, so a real save often touches three
    // fields. Three separate lines make one action look like three.
    renderActivity({
      events: [
        event({ id: 1, revisionId: "r9", field: "status", fromValue: "todo", toValue: "done" }),
        event({ id: 2, revisionId: "r9", field: "dueAt", fromValue: null, toValue: "2026-12-01" }),
        event({ id: 3, revisionId: "r9", field: "priority", fromValue: "0", toValue: "2" }),
      ],
    });

    const entries = screen.getByRole("list", { name: "アクティビティ" }).children;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toContain("未着手 → 完了");
    expect(entries[0]!.textContent).toContain("— → 2026-12-01");
    expect(entries[0]!.textContent).toContain("None → Medium");
  });

  it("keeps separate saves separate", () => {
    renderActivity({
      events: [
        event({ id: 1, revisionId: "r1", field: "status", fromValue: "todo", toValue: "done" }),
        event({ id: 2, revisionId: "r2", field: "status", fromValue: "done", toValue: "todo" }),
      ],
    });

    expect(screen.getByRole("list", { name: "アクティビティ" }).children).toHaveLength(2);
  });

  it("shows a note written with a change inside that change's entry", () => {
    // Rendered as its own item it would read as a coincidence of timing rather
    // than the reason for what happened.
    renderActivity({
      events: [
        event({ id: 1, revisionId: "r5", field: "status", fromValue: "todo", toValue: "blocked" }),
      ],
      comments: [comment({ id: 1, revisionId: "r5", body: "APIレビュー待ち" })],
    });

    const entries = screen.getByRole("list", { name: "アクティビティ" }).children;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toContain("未着手 → ブロック中");
    expect(entries[0]!.textContent).toContain("APIレビュー待ち");
  });

  it("leaves a standalone comment standing alone", () => {
    renderActivity({
      events: [event({ id: 1, revisionId: "r1", field: "created" })],
      comments: [comment({ id: 1, revisionId: null, body: "ただの補足" })],
    });

    expect(screen.getByRole("list", { name: "アクティビティ" }).children).toHaveLength(2);
  });

  it("offers no way to edit a note that belongs to a change", () => {
    // It is part of the record of that save. Editing it in place would let the
    // stated reason drift away from what actually happened.
    renderActivity({
      events: [
        event({ id: 1, revisionId: "r5", field: "status", fromValue: "todo", toValue: "blocked" }),
      ],
      comments: [comment({ id: 1, revisionId: "r5", body: "理由" })],
    });

    expect(screen.queryByRole("button", { name: "コメントを編集" })).not.toBeInTheDocument();
  });

  it("reads stored values back in the words the rest of the UI uses", () => {
    renderActivity({
      events: [
        event({
          id: 1,
          revisionId: "r1",
          field: "status",
          fromValue: "todo",
          toValue: "in_progress",
        }),
      ],
    });

    expect(screen.getByText(/未着手 → 進行中/)).toBeInTheDocument();
  });

  it("shows a cleared value as a dash rather than as nothing", () => {
    // An empty string reads as a rendering bug; "—" says a value was removed.
    renderActivity({
      events: [
        event({ id: 1, revisionId: "r1", field: "dueAt", fromValue: "2026-12-01", toValue: null }),
      ],
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
