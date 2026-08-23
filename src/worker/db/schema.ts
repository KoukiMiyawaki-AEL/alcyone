import { sql } from "drizzle-orm";
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const todosTable = sqliteTable("todos", {
  id: int().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  completed: int({ mode: "boolean" }).notNull().default(false),
  createdAt: text()
    .notNull()
    .default(sql`(current_timestamp)`),
});
