import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";
import { z } from "zod";

import { recordServerError, recordShareView } from "./analytics";
import { createAuth } from "./auth";
import { exportKey, type ExportManifest, type ExportParams } from "./data-export";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, decodeCursor, paginate } from "./db/cursor";
import { createRepo, todoCursorValue, type Repo } from "./db/repo";
import { TODO_STATUSES } from "./db/schema";
import { bookmarkCookie, openSession } from "./db/session";
import {
  DEAD_LETTER_QUEUE,
  handleDeadLetters,
  handleObjectCleanup,
  type CleanupMessage,
} from "./object-cleanup";
import { clientIp, enforce } from "./rate-limit";
import { notifyUser } from "./realtime";
import { purgeExpiredDeletions } from "./scheduled";
import { getSharedView, newShareToken, purgeSharedView } from "./share";
import { validate } from "./validator";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const projectIdParamSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

/**
 * List options, read from the query string.
 *
 * Defaults live here rather than in the client so that hitting the endpoint
 * directly behaves the same as the UI does.
 */
const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

// Bounded and character-restricted: the token becomes part of a KV key, and an
// unbounded one is a way to write keys nobody intended.
const shareTokenParamSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

const exportParamSchema = z.object({ instanceId: z.string().min(1).max(200) });

// An enum, not a string: `part` becomes part of an R2 key, and a free-form one
// would let a caller walk out of their own prefix.
const exportPartParamSchema = exportParamSchema.extend({
  part: z.enum(["manifest", "projects", "todos", "attachments"]),
});

const searchQuerySchema = z
  .object({ q: z.string().trim().min(1).max(200) })
  .extend(pageQuerySchema.shape);

const todoQuerySchema = z
  .object({
    // "all" and "active" are not statuses — they are ways of not naming one.
    // Keeping them in the same parameter lets one query string express both
    // kinds of question.
    status: z.enum(["all", "active", ...TODO_STATUSES]).default("all"),
    sort: z.enum(["created", "due", "start", "priority"]).default("created"),
  })
  .extend(pageQuerySchema.shape);

/** Small enough to buffer in a Worker's 128MB without thinking about it. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * The editable fields of a todo, all optional.
 *
 * Every date and text field is `.nullable()`: `null` clears it and omitting it
 * leaves it alone. Collapsing those two would make "remove the due date"
 * impossible to say.
 */
const todoFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(TODO_STATUSES).optional(),
    startAt: z.iso.date().nullable().optional(),
    dueAt: z.iso.date().nullable().optional(),
    // Trimmed to null so that "" and "no description" are one state rather
    // than two that render identically.
    // The transform has to pass `undefined` straight through. Folding it into
    // `null` here would make every partial update blank the description —
    // "not mentioned" and "cleared" are exactly what this schema exists to
    // keep apart, and a test caught it doing the opposite.
    description: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .transform((value) =>
        value === undefined
          ? undefined
          : value === null || value.trim() === ""
            ? null
            : value.trim(),
      ),
    priority: z.number().int().min(0).max(3).optional(),
  })
  // Only catches the case where both arrive together — a request that moves
  // only one of them is checked against the other by the database. Recorded
  // here so the gap is visible rather than assumed away.
  .refine((v) => !(v.startAt && v.dueAt) || v.startAt <= v.dueAt, {
    message: "startAt must not be after dueAt",
    path: ["startAt"],
  });

// A title is the one thing a todo cannot be created without; everything else
// is optional here for the same reason it is optional on update — a task often
// starts as a line of text and gains detail later.
const createTodoSchema = z.intersection(
  z.object({ title: z.string().trim().min(1).max(200) }),
  todoFieldsSchema,
);

const app = new Hono<{
  Bindings: CloudflareBindings;
  Variables: RequestIdVariables & { db: D1DatabaseSession; repo: Repo; userId: string };
}>()
  // First in the chain so that everything downstream — including failures in
  // the auth middleware — can be tied back to one request. Also echoed to the
  // client as X-Request-Id, which is what makes a bug report actionable.
  .use("*", requestId())
  // Opens the request's D1 session before anything queries, and carries its
  // bookmark forward afterwards. First so that every downstream reader — auth
  // included — shares one ordering; see db/session.ts for why that matters.
  .use("*", async (c, next) => {
    const session = openSession(c.env.DB, c.req.header("Cookie"));
    c.set("db", session);

    await next();

    const cookie = bookmarkCookie(session, c.req.url);
    if (!cookie) return;

    try {
      // Appended rather than set: the auth endpoints issue their own cookies on
      // the same response, and overwriting them would sign the user straight
      // out.
      c.res.headers.append("Set-Cookie", cookie);
    } catch {
      // A response that came back from a subrequest — /api/realtime returns the
      // Durable Object's — has immutable headers, and appending to one throws.
      // Rebuilding is the only way to add anything to it.
      //
      // Except a 101: its WebSocket cannot be carried across a new Response, so
      // that one goes out without the bookmark. Harmless, because the socket
      // carries no queries of its own and the next ordinary request will set it.
      if (c.res.status === 101) return;

      const headers = new Headers(c.res.headers);
      headers.append("Set-Cookie", cookie);
      c.res = new Response(c.res.body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers,
      });
    }
  })
  // Better Auth owns everything under /api/auth. Mounted before the guard
  // below, since signing in obviously cannot require being signed in.
  .on(["GET", "POST"], "/api/auth/*", async (c) => {
    // Keyed by IP because these are the endpoints you can reach without an
    // account — which is exactly what makes them worth brute-forcing.
    const limited = await enforce(c.env.AUTH_RATE_LIMITER, clientIp(c), 60);
    if (limited) return limited;

    return createAuth(c.env, c.get("db")).handler(c.req.raw);
  })
  // Unauthenticated liveness probe. Kept outside the guard on purpose: a health
  // check that needs credentials cannot be used by an uptime monitor.
  .get("/api/health", (c) => c.json({ ok: true }))
  // The one endpoint anyone on the internet can reach with no account. Placed
  // above the guard for that reason, and rate limited by IP for the same reason
  // the auth endpoints are.
  //
  // KV answers it; D1 is consulted only on a miss. That is the whole point —
  // a link doing the rounds must not cost one database read per viewer.
  //
  // The limit is a middleware rather than a line in the handler so that the
  // handler's return type stays a union of `c.json(...)` calls. A bare
  // `Response` in there collapses the whole route's RPC type to `unknown`, and
  // the client silently loses every field.
  .use("/api/shared/*", async (c, next) => {
    const limited = await enforce(c.env.PUBLIC_RATE_LIMITER, clientIp(c), 60);
    if (limited) return limited;
    await next();
  })
  .get("/api/shared/:token", validate("param", shareTokenParamSchema), async (c) => {
    const { token } = c.req.valid("param");
    const { view, cached } = await getSharedView(c.env.SHARE_CACHE, c.get("db"), token);

    // Fire-and-forget by design: `writeDataPoint` returns nothing and cannot
    // fail the request. Counting a read must never cost the read.
    recordShareView(c.env.ANALYTICS, token, view ? (cached ? "hit" : "miss") : "not_found");

    // A revoked link and a token that never existed answer identically. Any
    // difference would let someone probe for tokens that used to work.
    if (!view) return c.json({ error: "Not found" }, 404);

    return c.json(view);
  })
  // Everything past here requires a session, and every query is scoped to the
  // signed-in user. Both are established in one place so that no handler can
  // forget either.
  //
  // Built per request: `env` is not available at module scope, and a shared
  // instance would leak state across invocations. `Variables` does not
  // participate in the RPC schema, so `hc<AppType>` inference is unaffected.
  .use("/api/*", async (c, next) => {
    const session = await createAuth(c.env, c.get("db")).api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("userId", session.user.id);
    c.set("repo", createRepo(c.get("db"), session.user.id));
    await next();
  })
  // Fans a mutation out to the user's other open tabs.
  //
  // A middleware rather than a call in each handler, for the same reason the
  // ownership scoping lives in the repository: twelve call sites is twelve
  // chances to forget, and the one that gets forgotten is silently stale UI.
  //
  // Runs after `next()` and only on a successful non-GET, so a rejected write
  // does not tell anyone to refetch. Never awaited on the response path — a
  // broadcast failing must not fail a write that already committed.
  .use("/api/*", async (c, next) => {
    await next();

    if (c.req.method === "GET" || !c.res.ok) return;

    try {
      c.executionCtx.waitUntil(notifyUser(c.env, c.get("userId")));
    } catch {
      // `executionCtx` throws when there is none — `app.request()` in tests
      // supplies no context. The broadcast is not what those tests assert.
    }
  })
  // WebSocket upgrade. Sits behind the same session guard as everything else:
  // browsers cannot set headers on a WebSocket handshake, but they do send
  // cookies, which is what the session is carried in.
  //
  // Deliberately not part of the `hc<AppType>` surface in any useful sense —
  // the client opens this with `new WebSocket`, not with the RPC client.
  .get("/api/realtime", (c) => {
    const id = c.env.USER_CHANNEL.idFromName(c.get("userId"));
    return c.env.USER_CHANNEL.get(id).fetch(c.req.raw);
  })
  .post("/api/projects/:projectId/share", validate("param", projectIdParamSchema), async (c) => {
    const { projectId } = c.req.valid("param");
    const repo = c.get("repo");

    // Idempotent: asking twice returns the same link rather than quietly
    // invalidating the one already sent to someone.
    const [existing] = await repo.shares.find(projectId);
    if (existing) return c.json({ token: existing.token });

    const [created] = await repo.shares.create(projectId, newShareToken());
    // `shares.create` is scoped by a foreign key, not by an ownership subquery,
    // so a project that is not this user's fails the insert rather than
    // succeeding — but the id could also simply not exist.
    if (!created) return c.json({ error: "Not found" }, 404);

    return c.json({ token: created.token }, 201);
  })
  .get("/api/projects/:projectId/share", validate("param", projectIdParamSchema), async (c) => {
    const { projectId } = c.req.valid("param");
    const [existing] = await c.get("repo").shares.find(projectId);

    return c.json({ token: existing?.token ?? null });
  })
  .delete("/api/projects/:projectId/share", validate("param", projectIdParamSchema), async (c) => {
    const { projectId } = c.req.valid("param");
    const [removed] = await c.get("repo").shares.remove(projectId);

    if (!removed) return c.json({ error: "Not found" }, 404);

    // Awaited, not deferred: revocation is the one operation here where being
    // late actually matters. KV is still eventually consistent, so this bites
    // within the TTL rather than at once — recorded in ADR 0022.
    await purgeSharedView(c.env.SHARE_CACHE, removed.token);

    return c.body(null, 204);
  })
  // Starts a data export and returns immediately with an id to poll. The work
  // is a Workflow, so "started" is durable — the response is a receipt, not a
  // promise this Worker has to keep alive.
  .post("/api/exports", async (c) => {
    const instance = await c.env.DATA_EXPORT.create({
      params: { userId: c.get("userId") } satisfies ExportParams,
    });
    return c.json({ id: instance.id, status: (await instance.status()).status }, 202);
  })
  // Polled by the client. Returns the manifest once there is one, so a caller
  // never has to guess which parts exist.
  .get("/api/exports/:instanceId", validate("param", exportParamSchema), async (c) => {
    const { instanceId } = c.req.valid("param");

    let status;
    try {
      status = await c.env.DATA_EXPORT.get(instanceId);
    } catch {
      // An unknown id and someone else's id must look the same from here.
      return c.json({ error: "Not found" }, 404);
    }

    const state = await status.status();
    // The instance id alone proves nothing about who owns the export, so
    // ownership is checked against the object store, where the key carries the
    // user id. Trusting the workflow's own output would trust the caller.
    const manifest = await c.env.ATTACHMENTS.get(
      exportKey(c.get("userId"), instanceId, "manifest"),
    );

    return c.json({
      id: instanceId,
      status: state.status,
      manifest: manifest ? ((await manifest.json()) as ExportManifest) : null,
    });
  })
  // Streams one part. Scoped by building the key from the session's user id
  // rather than accepting one, so there is no key to tamper with.
  .get("/api/exports/:instanceId/:part", validate("param", exportPartParamSchema), async (c) => {
    const { instanceId, part } = c.req.valid("param");
    const object = await c.env.ATTACHMENTS.get(exportKey(c.get("userId"), instanceId, part));

    if (!object) return c.json({ error: "Not found" }, 404);

    return new Response(object.body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${part}.json"`,
      },
    });
  })
  // Search runs across every project the user owns, so it is not nested under
  // one. `q` is required and non-empty: an empty search is not "everything",
  // it is a mistake, and returning the whole table for it is how a search box
  // becomes the most expensive query in the application.
  .get("/api/search", validate("query", searchQuerySchema), async (c) => {
    const { q, cursor, limit } = c.req.valid("query");
    const rows = await c
      .get("repo")
      .todos.search(q, { cursor: cursor ? decodeCursor(cursor) : null, limit });

    return c.json(paginate(rows, limit, (row) => ({ value: row.rank, id: row.id })));
  })
  .get("/api/projects", validate("query", pageQuerySchema), async (c) => {
    const { cursor, limit } = c.req.valid("query");
    const rows = await c
      .get("repo")
      .projects.list({ cursor: cursor ? decodeCursor(cursor) : null, limit });

    // An envelope rather than a bare array. It was one before, and changing
    // that later would have broken every caller — the exact one-way door the
    // readiness map recorded as D8.
    return c.json(paginate(rows, limit, (row) => ({ value: row.id, id: row.id })));
  })
  .post("/api/projects", validate("json", createProjectSchema), async (c) => {
    const { name } = c.req.valid("json");
    const [project] = await c.get("repo").projects.create({ name });
    return c.json(project, 201);
  })
  .delete("/api/projects/:projectId", validate("param", projectIdParamSchema), async (c) => {
    const { projectId } = c.req.valid("param");
    const repo = c.get("repo");

    // Soft delete, so this marks rather than removes — but still batched,
    // because D1 has no interactive transactions and a project whose todos
    // were marked while it was not is worse than either outcome alone. A
    // future audit-log insert belongs in this same array.
    const [, deleted] = await repo.batch([
      repo.todos.removeByProject(projectId),
      repo.projects.remove(projectId),
    ]);

    if (deleted.length === 0) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.body(null, 204);
  })
  .post("/api/projects/:projectId/restore", validate("param", projectIdParamSchema), async (c) => {
    const { projectId } = c.req.valid("param");
    const repo = c.get("repo");

    // Mirror of the delete: parent first here, since `restore` looks the row
    // up by id regardless of its deleted state, and the todos' scope check
    // goes through the project.
    const [restored] = await repo.projects.restore(projectId);
    if (!restored) {
      return c.json({ error: "Not found" }, 404);
    }

    await repo.todos.restoreByProject(projectId);
    return c.json(restored);
  })
  .get(
    "/api/projects/:projectId/todos",
    validate("param", projectIdParamSchema),
    validate("query", todoQuerySchema),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const { status, sort, cursor, limit } = c.req.valid("query");
      const repo = c.get("repo");

      // One round trip for both. Returning an envelope rather than a bare array
      // gives the page its title without a second request, and leaves room to
      // add a cursor later without a breaking change to the response shape.
      const [[project], rows] = await repo.batch([
        repo.projects.find(projectId),
        repo.todos.listByProject(projectId, {
          status,
          sort,
          cursor: cursor ? decodeCursor(cursor) : null,
          limit,
        }),
      ]);

      if (!project) {
        return c.json({ error: "Not found" }, 404);
      }

      const page = paginate(rows, limit, (row) => ({
        value: todoCursorValue(sort, row),
        id: row.id,
      }));

      return c.json({ project, todos: page.items, nextCursor: page.nextCursor });
    },
  )
  .post(
    "/api/projects/:projectId/todos",
    validate("param", projectIdParamSchema),
    validate("json", createTodoSchema),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const fields = c.req.valid("json");
      const repo = c.get("repo");

      // Checked explicitly so a missing project is a 404 rather than an
      // opaque 500 from the foreign key.
      const [project] = await repo.projects.find(projectId);
      if (!project) {
        return c.json({ error: "Not found" }, 404);
      }

      const [todo] = await repo.todos.create({ ...fields, projectId });
      return c.json(todo, 201);
    },
  )
  // One partial update covering every field, replacing the pair of endpoints
  // that used to split "completed" from everything else. That split existed
  // because completion was a boolean and the rest were details; now that
  // completion is a field like any other, two endpoints would only be two
  // places to forget the ownership scope.
  .patch(
    "/api/todos/:id",
    validate("param", idParamSchema),
    validate("json", todoFieldsSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const [todo] = await c.get("repo").todos.update(id, c.req.valid("json"));

      if (!todo) {
        return c.json({ error: "Not found" }, 404);
      }

      return c.json(todo);
    },
  )
  .delete("/api/todos/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const [todo] = await c.get("repo").todos.remove(id);

    if (!todo) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.body(null, 204);
  })
  .get("/api/todos/:id/attachments", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await c.get("repo").attachments.listByTodo(id));
  })
  .post("/api/todos/:id/attachments", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const repo = c.get("repo");

    // The todo has to exist and be this user's before anything is written to
    // R2 — an orphaned object is invisible to every query and never cleaned up.
    const [todo] = await repo.todos.find(id);
    if (!todo) {
      return c.json({ error: "Not found" }, 404);
    }

    // Keyed by user, not IP: the caller is authenticated, and one user behind a
    // shared address should not exhaust everyone else's allowance.
    const limited = await enforce(c.env.UPLOAD_RATE_LIMITER, c.get("userId"), 60);
    if (limited) return limited;

    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "Bad Request", issues: [{ message: "file is required" }] }, 400);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "Payload Too Large" }, 413);
    }

    // Random rather than derived from the filename: keys are only unguessable
    // if nothing about them is guessable, and two todos may share a filename.
    const key = `${todo.id}/${crypto.randomUUID()}`;
    await c.env.ATTACHMENTS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });

    const [attachment] = await repo.attachments.create({
      todoId: todo.id,
      key,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    });

    return c.json(attachment, 201);
  })
  .get("/api/attachments/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const [attachment] = await c.get("repo").attachments.find(id);
    if (!attachment) {
      return c.json({ error: "Not found" }, 404);
    }

    const object = await c.env.ATTACHMENTS.get(attachment.key);
    if (!object) {
      // The row and the object can drift — R2 is not part of the transaction.
      // Saying "not found" is honest; pretending it is a server fault is not.
      return c.json({ error: "Not found" }, 404);
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Length": String(attachment.size),
        // `attachment` rather than inline: these are arbitrary user uploads, and
        // rendering them on our own origin would be a stored-XSS vector.
        "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
      },
    });
  })
  .delete("/api/attachments/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const [attachment] = await c.get("repo").attachments.remove(id);
    if (!attachment) {
      return c.json({ error: "Not found" }, 404);
    }

    // Row first, object second. The other order can delete the file and then
    // fail, leaving a row pointing at nothing.
    await c.env.ATTACHMENTS.delete(attachment.key);
    return c.body(null, 204);
  })
  .post("/api/todos/:id/restore", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const [todo] = await c.get("repo").todos.restore(id);

    if (!todo) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json(todo);
  })
  .notFound((c) => c.json({ error: "Not found" }, 404))
  // Deliberately never logs the request body or headers: a body can hold a
  // password or a project name, and once personal data is in Workers Logs it
  // cannot be taken out again within the retention window. See docs/pii.md.
  .onError((err, c) => {
    // Structured JSON so the Workers dashboard can filter on these fields.
    // The message is deliberately not echoed to the client.
    console.error(
      JSON.stringify({
        level: "error",
        requestId: c.get("requestId"),
        // Present only once the auth middleware has run — an unauthenticated
        // failure has no user, and inventing one would be misleading.
        userId: c.get("userId"),
        message: err.message,
        stack: err.stack,
        method: c.req.method,
        path: c.req.path,
      }),
    );
    // Logged above for reading one failure; recorded here for counting them.
    // A log tells you what happened, a time series tells you it started.
    recordServerError(c.env.ANALYTICS, {
      path: c.req.path,
      method: c.req.method,
      requestId: c.get("requestId"),
    });

    return c.json({ error: "Internal Server Error" }, 500);
  });

// Re-exported because the runtime resolves `class_name` in wrangler.jsonc
// against this module's exports. Without it the binding exists but every call
// fails at runtime, and `wrangler types` cannot type the namespace either.
export { UserChannel } from "./realtime";
export { DataExportWorkflow } from "./data-export";

export type AppType = typeof app;

// Named so tests can drive the Hono app directly with `app.request()`. The
// default export has to be the handler object now that there is more than one
// entry point into this Worker.
export { app };

export default {
  fetch: app.fetch,
  // Deletes the R2 objects whose rows the purge already removed. Separate from
  // `scheduled` on purpose: the cron decides *what* is expired, this does the
  // unbounded I/O, and neither has to fit in the other's time budget.
  queue: async (batch, env) => {
    // One handler, two queues — the runtime distinguishes them only by name.
    // Getting this branch wrong would run the deletion again on messages that
    // already failed it as many times as they are allowed to.
    if (batch.queue === DEAD_LETTER_QUEUE) {
      handleDeadLetters(batch);
      return;
    }

    await handleObjectCleanup(batch, env);
  },
  scheduled: async (_controller, env, ctx) => {
    // waitUntil so a slow purge cannot hold the scheduled invocation open, and
    // so a failure surfaces in the invocation rather than being swallowed.
    ctx.waitUntil(purgeExpiredDeletions(env));
  },
} satisfies ExportedHandler<CloudflareBindings, CleanupMessage>;
