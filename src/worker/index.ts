import { Hono } from "hono";
import { z } from "zod";

import { createAuth } from "./auth";
import { createRepo, type Repo } from "./db/repo";
import { validate } from "./validator";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const createTodoSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const projectIdParamSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

const updateTodoSchema = z.object({
  completed: z.boolean(),
});

const app = new Hono<{
  Bindings: CloudflareBindings;
  Variables: { repo: Repo; userId: string };
}>()
  // Better Auth owns everything under /api/auth. Mounted before the guard
  // below, since signing in obviously cannot require being signed in.
  .on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw))
  // Unauthenticated liveness probe. Kept outside the guard on purpose: a health
  // check that needs credentials cannot be used by an uptime monitor.
  .get("/api/health", (c) => c.json({ ok: true }))
  // Everything past here requires a session, and every query is scoped to the
  // signed-in user. Both are established in one place so that no handler can
  // forget either.
  //
  // Built per request: `env` is not available at module scope, and a shared
  // instance would leak state across invocations. `Variables` does not
  // participate in the RPC schema, so `hc<AppType>` inference is unaffected.
  .use("/api/*", async (c, next) => {
    const session = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("userId", session.user.id);
    c.set("repo", createRepo(c.env.DB, session.user.id));
    await next();
  })
  .get("/api/projects", async (c) => {
    const projects = await c.get("repo").projects.list();
    return c.json(projects);
  })
  .post("/api/projects", validate("json", createProjectSchema), async (c) => {
    const { name } = c.req.valid("json");
    const [project] = await c.get("repo").projects.create({ name });
    return c.json(project, 201);
  })
  .delete("/api/projects/:projectId", validate("param", projectIdParamSchema), async (c) => {
    const { projectId } = c.req.valid("param");
    const repo = c.get("repo");

    // Children before the parent, or the foreign key rejects it. Batched
    // because D1 has no interactive transactions: statements run sequentially
    // and the whole sequence rolls back if any one fails. A future audit-log
    // insert belongs in this same array.
    const [, deleted] = await repo.batch([
      repo.todos.removeByProject(projectId),
      repo.projects.remove(projectId),
    ]);

    if (deleted.length === 0) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.body(null, 204);
  })
  .get("/api/projects/:projectId/todos", validate("param", projectIdParamSchema), async (c) => {
    const { projectId } = c.req.valid("param");
    const repo = c.get("repo");

    // One round trip for both. Returning an envelope rather than a bare array
    // gives the page its title without a second request, and leaves room to
    // add a cursor later without a breaking change to the response shape.
    const [[project], todos] = await repo.batch([
      repo.projects.find(projectId),
      repo.todos.listByProject(projectId),
    ]);

    if (!project) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({ project, todos });
  })
  .post(
    "/api/projects/:projectId/todos",
    validate("param", projectIdParamSchema),
    validate("json", createTodoSchema),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const { title } = c.req.valid("json");
      const repo = c.get("repo");

      // Checked explicitly so a missing project is a 404 rather than an
      // opaque 500 from the foreign key.
      const [project] = await repo.projects.find(projectId);
      if (!project) {
        return c.json({ error: "Not found" }, 404);
      }

      const [todo] = await repo.todos.create({ title, projectId });
      return c.json(todo, 201);
    },
  )
  .patch(
    "/api/todos/:id",
    validate("param", idParamSchema),
    validate("json", updateTodoSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { completed } = c.req.valid("json");
      const [todo] = await c.get("repo").todos.setCompleted(id, completed);

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
  .notFound((c) => c.json({ error: "Not found" }, 404))
  .onError((err, c) => {
    // Structured JSON so the Workers dashboard can filter on these fields.
    // The message is deliberately not echoed to the client.
    console.error(
      JSON.stringify({
        level: "error",
        message: err.message,
        stack: err.stack,
        method: c.req.method,
        path: c.req.path,
      }),
    );
    return c.json({ error: "Internal Server Error" }, 500);
  });

export type AppType = typeof app;
export default app;
