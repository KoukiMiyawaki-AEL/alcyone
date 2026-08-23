import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import { todosTable } from "./db/schema";

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
    const todos = await db
      .select()
      .from(todosTable)
      .orderBy(todosTable.id)
      .all();
    return c.json(todos);
  })
  .post("/api/todos", zValidator("json", createTodoSchema), async (c) => {
    const { title } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const [todo] = await db
      .insert(todosTable)
      .values({ title })
      .returning();
    return c.json(todo, 201);
  })
  .patch(
    "/api/todos/:id",
    zValidator("param", idParamSchema),
    zValidator("json", updateTodoSchema),
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
  .delete(
    "/api/todos/:id",
    zValidator("param", idParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = drizzle(c.env.DB);
      const [todo] = await db
        .delete(todosTable)
        .where(eq(todosTable.id, id))
        .returning();

      if (!todo) {
        return c.json({ error: "Not found" }, 404);
      }

      return c.body(null, 204);
    },
  );

export type AppType = typeof app;
export default app;
