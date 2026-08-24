import type { projectsTable } from "@/worker/db/schema";

export type Project = typeof projectsTable.$inferSelect;
