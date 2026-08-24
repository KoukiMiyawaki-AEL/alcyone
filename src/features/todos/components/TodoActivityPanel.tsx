import { useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

import { addComment, editComment, removeComment } from "../api";
import type { TodoComment, TodoEvent } from "../types";
import { TodoActivity as ActivityList } from "./TodoActivity";

/**
 * Loads a task's comments and history, and keeps them fresh after a write.
 *
 * Fetched here rather than in the route's loader on purpose: the activity is
 * only ever visible inside the dialog, and loading it with the list would mean
 * every row of every project paying for a panel almost nobody opens.
 *
 * That is a deliberate exception to the loader-first rule in CLAUDE.md, and the
 * reason it is safe is that nothing links to it — there is no URL that shows
 * activity, so there is no state here worth putting in one.
 */
type Activity = { comments: TodoComment[]; events: TodoEvent[] };

/**
 * An empty panel is the right failure here: this dialog's job is editing the
 * task, and a broken activity list must not take that down with it.
 */
async function fetchActivity(todoId: number): Promise<Activity> {
  try {
    const res = await apiClient.api.todos[":id"].activity.$get({ param: { id: String(todoId) } });
    return res.ok ? await res.json() : { comments: [], events: [] };
  } catch {
    return { comments: [], events: [] };
  }
}

export function TodoActivity({ todoId }: { todoId: number }) {
  const [data, setData] = useState<Activity | null>(null);

  useEffect(() => {
    // Guards against a response arriving after the dialog moved to another
    // task, which would show one task's history under another's title.
    let current = true;
    void fetchActivity(todoId).then((next) => {
      if (current) setData(next);
    });

    return () => {
      current = false;
    };
  }, [todoId]);

  /** Refetches only when the write succeeded — `mutate()` has already reported failure. */
  const after = async (ok: boolean) => {
    if (ok) setData(await fetchActivity(todoId));
    return ok;
  };

  return (
    <ActivityList
      comments={data?.comments ?? []}
      events={data?.events ?? []}
      loading={data === null}
      onAdd={async (body) => after(await addComment(todoId, body))}
      onEdit={async (id, body) => after(await editComment(id, body))}
      onRemove={async (id) => after(await removeComment(id))}
    />
  );
}
