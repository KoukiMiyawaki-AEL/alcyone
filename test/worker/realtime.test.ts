import {
  createExecutionContext,
  env,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker";
import type { UserChannel } from "../../src/worker/realtime";
import { notifyUser } from "../../src/worker/realtime";
import { jsonHeaders, resetAll, signUp, uniqueKey } from "./auth-helper";

/** Reaches into a user's channel the way the Worker addresses it. */
function channelOf(userId: string) {
  const id = env.USER_CHANNEL.idFromName(userId);
  return { id, stub: env.USER_CHANNEL.get(id) };
}

/** Opens a socket the way a browser would, and collects what arrives. */
async function openSocket(headers: Headers): Promise<{ socket: WebSocket; seen: string[] }> {
  const res = await app.request(
    "http://localhost/api/realtime",
    { headers: new Headers([...headers, ["Upgrade", "websocket"]]) },
    env,
  );
  expect(res.status).toBe(101);

  const socket = res.webSocket;
  if (!socket) throw new Error("no websocket on the upgrade response");
  socket.accept();

  const seen: string[] = [];
  socket.addEventListener("message", (event) => {
    seen.push(String(event.data));
  });
  return { socket, seen };
}

describe("realtime channel", () => {
  let alice: Headers;

  beforeEach(async () => {
    await resetAll();
    alice = await signUp("alice@example.com", "Alice");
  });

  it("refuses a plain GET that is not an upgrade", async () => {
    // A browser hitting the URL directly should get a clear answer rather than
    // a socket that is never spoken to.
    const res = await app.request("/api/realtime", { headers: alice }, env);
    expect(res.status).toBe(426);
  });

  it("requires a session", async () => {
    const res = await app.request(
      "http://localhost/api/realtime",
      { headers: new Headers([["Upgrade", "websocket"]]) },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("delivers a broadcast to an open tab", async () => {
    const { seen } = await openSocket(alice);

    await notifyUser(env, (await currentUserId(alice)) ?? "");

    expect(seen).toEqual([JSON.stringify({ type: "invalidate" })]);
  });

  it("delivers to every tab the same user has open", async () => {
    const a = await openSocket(alice);
    const b = await openSocket(alice);

    await notifyUser(env, (await currentUserId(alice)) ?? "");

    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(1);
  });

  it("does not deliver another user's changes", async () => {
    // The isolation that matters: channels are addressed by user id, so Bob
    // writing must never reach Alice's tab.
    const bob = await signUp("bob@example.com", "Bob");
    const { seen } = await openSocket(alice);

    await notifyUser(env, (await currentUserId(bob)) ?? "");

    expect(seen).toEqual([]);
  });

  it("registers the socket with the object rather than holding it in memory", async () => {
    // Hibernation is the reason for `acceptWebSocket`: the runtime, not this
    // object, owns the connection list. If this ever regresses to `accept()`,
    // idle tabs start pinning the object in memory.
    const userId = (await currentUserId(alice)) ?? "";
    await openSocket(alice);

    const { id, stub } = channelOf(userId);
    const count = await runInDurableObject(stub, (_instance: UserChannel, state) => {
      return state.getWebSockets().length;
    });
    expect(id.toString()).toBeTruthy();
    expect(count).toBe(1);
  });

  it("broadcasts after a successful mutation", async () => {
    const { seen } = await openSocket(alice);

    const ctx = createExecutionContext();
    const res = await app.request(
      "/api/projects",
      {
        method: "POST",
        headers: jsonHeaders(alice),
        body: JSON.stringify({ name: "Work", key: uniqueKey() }),
      },
      env,
      ctx,
    );
    expect(res.status).toBe(201);

    // The broadcast is deliberately not on the response path — the write is
    // already committed by the time the response returns. So the test has to
    // wait for the deferred work the way the runtime would.
    await waitOnExecutionContext(ctx);

    expect(seen).toHaveLength(1);
  });

  it("stays quiet when the mutation was rejected", async () => {
    // A refused write leaves the data unchanged, so telling every tab to
    // refetch would be pure noise.
    const { seen } = await openSocket(alice);

    const ctx = createExecutionContext();
    const res = await app.request(
      "/api/projects",
      { method: "POST", headers: jsonHeaders(alice), body: JSON.stringify({ name: "  " }) },
      env,
      ctx,
    );
    expect(res.status).toBe(400);
    await waitOnExecutionContext(ctx);

    expect(seen).toEqual([]);
  });

  it("stays quiet on a read", async () => {
    const { seen } = await openSocket(alice);

    const ctx = createExecutionContext();
    await app.request("/api/projects", { headers: alice }, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(seen).toEqual([]);
  });
});

/** The id the channel is keyed by, read back through the session. */
async function currentUserId(headers: Headers): Promise<string | undefined> {
  const res = await app.request("/api/auth/get-session", { headers }, env);
  const body = (await res.json()) as { user?: { id: string } } | null;
  return body?.user?.id;
}
