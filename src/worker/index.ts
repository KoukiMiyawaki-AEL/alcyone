import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import { todosTable } from "./db/schema";
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

const app = new Hono<{ Bindings: CloudflareBindings }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  .get("/api/todos", async (c) => {
    const db = drizzle(c.env.DB);
    const todos = await db.select().from(todosTable).orderBy(todosTable.id).all();
    return c.json(todos);
  })
  .post("/api/todos", validate("json", createTodoSchema), async (c) => {
    const { title } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const [todo] = await db.insert(todosTable).values({ title }).returning();
    return c.json(todo, 201);
  })
  .patch(
    "/api/todos/:id",
    validate("param", idParamSchema),
    validate("json", updateTodoSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { completed } = c.req.valid("json");
      const db = drizzle(c.env.DB);
      const [todo] = await db
        .update(todosTable)
        .set({ completed })
        .where(eq(todosTable.id, id))
        .returning();

      if (!todo) {
        return c.json({ error: "Not found" }, 404);
      }

      return c.json(todo);
    },
  )
  .delete("/api/todos/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const [todo] = await db.delete(todosTable).where(eq(todosTable.id, id)).returning();

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
