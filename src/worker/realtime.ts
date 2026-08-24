import { DurableObject } from "cloudflare:workers";

/**
 * One instance per user, holding that user's open tabs.
 *
 * The problem it solves: a Worker invocation has no idea which other
 * invocations exist, so it cannot tell someone's other tab that a todo
 * changed. A Durable Object is addressable by name and single-instance, which
 * makes "the place where this user's connections live" expressible at all.
 *
 * Uses the hibernation API — `acceptWebSocket` rather than `accept` — so idle
 * connections do not keep the object in memory and billed. A tab left open all
 * day costs nothing while nothing happens to it.
 *
 * Deliberately holds no application data. It is a fan-out point; the database
 * remains the only source of truth, and clients refetch when poked. That keeps
 * this object impossible to get *wrong* in a way that loses data.
 */
export class UserChannel extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    // Indexed rather than destructured: `Object.values` on WebSocketPair widens
    // to `WebSocket | undefined`, which is not what the runtime hands back.
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Tells every open tab that something changed, so they refetch. */
  broadcast(): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(JSON.stringify({ type: "invalidate" }));
      } catch {
        // A socket can die between being listed and being written to. One
        // dead tab must not stop the others from being told.
      }
    }
  }

  /** Required by the hibernation API; clients are not expected to send. */
  webSocketMessage(): void {}

  webSocketClose(socket: WebSocket, code: number): void {
    // 1006 means the connection dropped without a close frame, and passing it
    // back to close() is rejected as an invalid code.
    socket.close(code === 1006 ? 1000 : code);
  }
}

/**
 * Pokes a user's channel after a mutation.
 *
 * Never awaited on the request path by callers — a broadcast failing must not
 * fail the write that already succeeded. Realtime is an optimisation; the data
 * is already safe.
 */
export async function notifyUser(env: CloudflareBindings, userId: string): Promise<void> {
  try {
    const id = env.USER_CHANNEL.idFromName(userId);
    await env.USER_CHANNEL.get(id).broadcast();
  } catch {
    // Swallowed on purpose. See above.
  }
}
