import { Hono } from "hono";
import { z } from "zod";

import { createRepo, type Repo } from "./db/repo";
import { validate } from "./validator";

const createTodoSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const updateTodoSchema = z.object({
  completed: z.boolean(),
});

const app = new Hono<{ Bindings: CloudflareBindings; Variables: { repo: Repo } }>()
  // Built per request: `env` is not available at module scope, and a shared
  // instance would leak state across invocations. Constructing it here rather
  // than in each handler keeps `drizzle()` — and any future owner filter — in
  // one place. `Variables` does not participate in the RPC schema, so
  // `hc<AppType>` inference is unaffected.
  .use("/api/*", async (c, next) => {
    c.set("repo", createRepo(c.env.DB));
    await next();
  })
  .get("/api/health", (c) => c.json({ ok: true }))
  .get("/api/todos", async (c) => {
    const todos = await c.get("repo").todos.list();
    return c.json(todos);
  })
  .post("/api/todos", validate("json", createTodoSchema), async (c) => {
    const { title } = c.req.valid("json");
    const [todo] = await c.get("repo").todos.create({ title });
    return c.json(todo, 201);
  })
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
