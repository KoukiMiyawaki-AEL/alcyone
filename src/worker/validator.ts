import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/**
 * `zValidator` with a fixed failure shape.
 *
 * Without a hook, a validation failure returns Hono's default 400 carrying the
 * raw zod error, which means the 400 body is whatever zod happens to emit. This
 * pins it to the same `{ error, ... }` shape the handlers use for 404/500 so
 * that docs/api/README.md describes one consistent contract.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Bad Request", issues: result.error.issues }, 400);
    }
  });
