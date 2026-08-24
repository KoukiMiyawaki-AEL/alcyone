import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Asserts the shape the migrations were supposed to produce.
 *
 * The rest of the suite exercises behaviour through the API, which would not
 * notice a rebuild silently dropping an index or a foreign key — drizzle-kit's
 * table-recreate path is known to drop table-level UNIQUE constraints, and
 * D1 ignores the `PRAGMA foreign_keys` guards it wraps the recreate in. These
 * checks are the ones that would catch that.
 *
 * Known gap: `test/apply-migrations.ts` runs against an empty database, so the
 * backfill and the `INSERT ... SELECT` data conversion never move a row here.
 * Those were rehearsed by hand against the local D1 — see
 * docs/adr/0011-expand-contract-migrations.md.
 */
async function tableInfo(table: string) {
  const { results } = await env.DB.prepare(`SELECT * FROM pragma_table_info('${table}')`).all<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>();
  return new Map(results.map((r) => [r.name, r]));
}

describe("migrations", () => {
  it("makes todos.projectId NOT NULL", async () => {
    expect((await tableInfo("todos")).get("projectId")?.notnull).toBe(1);
  });

  it("keeps the foreign key as NO ACTION", async () => {
    // CASCADE would let a future rebuild of `projects` silently delete every
    // todo, because D1 cannot turn foreign key enforcement off.
    const { results } = await env.DB.prepare("SELECT * FROM pragma_foreign_key_list('todos')").all<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      table: "projects",
      from: "projectId",
      to: "id",
      on_delete: "NO ACTION",
    });
  });

  it("keeps the projectId index after the table rebuild", async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='todos_project_id_idx'",
    ).first();
    expect(row).not.toBeNull();
  });

  it("leaves no timestamp defaults behind", async () => {
    // The database must not be able to write the old non-ISO format. If a
    // default comes back, rows start disagreeing about their own format.
    const todos = await tableInfo("todos");
    expect(todos.get("createdAt")?.dflt_value).toBeNull();
    expect(todos.get("updatedAt")?.dflt_value).toBeNull();
    expect((await tableInfo("projects")).get("createdAt")?.dflt_value).toBeNull();
  });

  it("makes projects.ownerId NOT NULL and points it at user", async () => {
    expect((await tableInfo("projects")).get("ownerId")?.notnull).toBe(1);

    const { results } = await env.DB.prepare(
      "SELECT * FROM pragma_foreign_key_list('projects')",
    ).all<{ table: string; from: string; to: string; on_delete: string }>();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      table: "user",
      from: "ownerId",
      to: "id",
      on_delete: "NO ACTION",
    });
  });

  it("keeps todos' foreign key and index through the parent rebuild", async () => {
    // The 0005 detach/reattach dropped and recreated `todos` to get at
    // `projects`. This is what notices if the reattach half is ever botched.
    const { results } = await env.DB.prepare("SELECT * FROM pragma_foreign_key_list('todos')").all<{
      table: string;
    }>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ table: "projects" });

    const idx = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='todos_project_id_idx'",
    ).first();
    expect(idx).not.toBeNull();
  });

  it("enforces the unique constraints Better Auth relies on, as indexes", async () => {
    // ADR 0011: table-level UNIQUE is silently dropped by drizzle's rebuild
    // path, so these must exist as indexes to survive one.
    for (const name of ["user_email_uidx", "session_token_uidx"]) {
      const row = await env.DB.prepare('SELECT "unique" FROM pragma_index_list(?) WHERE name = ?')
        .bind(name.startsWith("user") ? "user" : "session", name)
        .first<{ unique: number }>();
      expect(row?.unique, name).toBe(1);
    }
  });

  it("drops the temporary rebuild tables", async () => {
    // `_` is a LIKE wildcard, hence the ESCAPE.
    const { results } = await env.DB.prepare(
      String.raw`SELECT name FROM sqlite_master WHERE name LIKE '\_\_%' ESCAPE '\'`,
    ).all();
    expect(results).toEqual([]);
  });

  it("leaves no owner-less projects behind", async () => {
    // 0001 seeded a global "Inbox" project. Once projects require an owner that
    // cannot exist, so 0005 deleted it along with any other pre-auth rows. The
    // invariant worth pinning is the absence, not the seed.
    const row = await env.DB.prepare(
      "SELECT count(*) AS n FROM projects WHERE ownerId IS NULL",
    ).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
