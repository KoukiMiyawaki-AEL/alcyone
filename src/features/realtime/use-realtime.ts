import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/** Grows 1s → 2s → 4s … so a Worker deploy does not get hammered by every tab. */
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * Keeps this tab's data in step with the user's other tabs and devices.
 *
 * The server sends a bare "something changed" rather than the change itself.
 * That is the whole design: a payload would be a second way to learn what the
 * data is, and the two would eventually disagree. Invalidating and refetching
 * costs one request and cannot drift — the database stays the only source of
 * truth.
 *
 * Connects only while signed in. The handshake carries the session cookie, so
 * an anonymous socket would just be refused.
 */
export function useRealtime(isSignedIn: boolean): void {
  const router = useRouter();

  useEffect(() => {
    if (!isSignedIn) return;

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    // Survives the reconnect closure, unlike checking `socket` — a retry
    // scheduled before unmount would otherwise open a socket after it.
    let disposed = false;

    const connect = (): void => {
      if (disposed) return;

      const url = new URL("/api/realtime", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);

      socket.addEventListener("open", () => {
        attempt = 0;
      });

      socket.addEventListener("message", () => {
        // Deliberately ignores the message body. See above.
        void router.invalidate();
      });

      socket.addEventListener("close", () => {
        if (disposed) return;
        const delay = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      // 1000 rather than the default: an explicit close means "this tab is
      // done", not "the connection broke".
      socket?.close(1000);
    };
  }, [isSignedIn, router]);
}
