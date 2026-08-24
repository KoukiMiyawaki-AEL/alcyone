import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";

type Part = { name: string; count: number };

/** How often to ask whether the export is finished, and for how long. */
const POLL_MS = 1_000;
const MAX_POLLS = 60;

/**
 * Starts a data export and waits for it.
 *
 * Polls rather than listening: the realtime channel broadcasts on mutations,
 * and an export changes nothing — wiring it in would mean teaching that
 * channel about a second kind of event for one screen. Polling a known id for
 * a minute is the smaller thing.
 */
export function DataExportCard() {
  const [state, setState] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  // Survives re-renders so that unmounting genuinely stops the polling, rather
  // than leaving a timer writing to a gone component.
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function start() {
    setState("running");
    setParts([]);

    const started = await apiClient.api.exports.$post();
    if (!started.ok) {
      setState("error");
      return;
    }

    const { id } = await started.json();
    setInstanceId(id);

    for (let i = 0; i < MAX_POLLS; i++) {
      if (cancelled.current) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));

      const res = await apiClient.api.exports[":instanceId"].$get({ param: { instanceId: id } });
      if (!res.ok) continue;

      const body = await res.json();
      if (body.manifest) {
        if (cancelled.current) return;
        setParts(body.manifest.parts);
        setState("ready");
        return;
      }
    }

    // Giving up on waiting is not the same as the export having failed — it
    // may still finish — so the message says which one this is.
    if (!cancelled.current) setState("error");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>データをエクスポート</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          プロジェクト・タスク・添付ファイルの記録をJSONで書き出します。削除済みの項目も、
          削除済みであることが分かる形で含まれます。
        </p>

        <div>
          <Button onClick={() => void start()} disabled={state === "running"}>
            {state === "running" ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <DownloadIcon className="size-4" />
            )}
            {state === "running" ? "書き出し中…" : "エクスポートを開始"}
          </Button>
        </div>

        {state === "error" && (
          <p className="text-sm text-destructive">
            エクスポートの結果を取得できませんでした。しばらくしてからもう一度お試しください。
          </p>
        )}

        {state === "ready" && instanceId && (
          <ul className="flex flex-col gap-2">
            {parts.map((part) => (
              <li key={part.name}>
                {/*
                  A real link, not a router navigation: the response carries
                  Content-Disposition, so the browser has to handle it as a
                  download rather than as a page.
                */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                  render={<a href={`/api/exports/${instanceId}/${part.name}`} />}
                >
                  <span>{part.name}.json</span>
                  <span className="text-muted-foreground">{part.count} 件</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
