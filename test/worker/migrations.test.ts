import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

// The shipped statement, read rather than re-typed.
import backfillOwner from "../../drizzle/0021_backfill_missing_owner.sql?raw";

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

    // Asserted by name rather than by position: `todos` gained a second
    // foreign key when tasks became assignable, and a test that counted them
    // would have failed for a change it has no opinion about.
    expect(results.find((fk) => fk.from === "projectId")).toMatchObject({
      table: "projects",
      to: "id",
      on_delete: "NO ACTION",
    });
    // Every one of them, present and future: the reason applies to the table,
    // not to one column.
    expect(results.map((fk) => fk.on_delete)).toEqual(results.map(() => "NO ACTION"));
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
      from: string;
    }>();
    expect(results.map((fk) => fk.table)).toContain("projects");

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

  it("keeps the search index's triggers, which nothing else would notice losing", async () => {
    // The one hazard of hand-writing the FTS objects (ADR 0018): drizzle-kit
    // does not know they exist, and SQLite drops a table's triggers with the
    // table. So drizzle's rebuild path for `todos` would remove all three
    // without a word, and the only symptom would be search results going
    // gradually stale — no error, no failing query.
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      // The project domain, for the same reason `user.role` uses triggers:
      // `projects` is referenced by four tables, so it cannot be rebuilt to
      // carry a CHECK (migration 0022).
      "projects_valid_insert",
      "projects_valid_update",
      "todos_fts_delete",
      "todos_fts_insert",
      "todos_fts_update",
      // Not the search index, but here for the same reason: a trigger nothing
      // else in the schema mentions. These two are the domain of `user.role`,
      // which cannot be a CHECK without rebuilding a table whose children
      // cascade on delete (migration 0019).
      "user_role_known_insert",
      "user_role_known_update",
    ]);
  });

  it("refuses a role the application does not know", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at)
         VALUES ('x', 'X', 'x@example.invalid', 0, 'superuser', 0, 0)`,
      ).run(),
    ).rejects.toThrow();

    // Against a row that exists: an UPDATE matching nothing fires no trigger,
    // and would pass here while proving the opposite of what it claims.
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at)
       VALUES ('role-probe', 'X', 'role-probe@example.invalid', 0, 'member', 0, 0)`,
    ).run();

    await expect(
      env.DB.prepare("UPDATE user SET role = 'superuser' WHERE id = 'role-probe'").run(),
    ).rejects.toThrow();

    await env.DB.prepare("DELETE FROM user WHERE id = 'role-probe'").run();
  });

  it("refuses a status the application does not know", async () => {
    // A CHECK rather than validation alone. Zod guards the endpoint; this
    // guards the table, including every path that does not go through zod —
    // a migration, a console, a future handler.
    await expect(
      env.DB.prepare(
        "INSERT INTO todos (title, createdAt, updatedAt, projectId, status) VALUES ('x','t','t',1,'almost')",
      ).run(),
    ).rejects.toThrow();
  });

  it("refuses a start date after the due date", async () => {
    // The rule validation cannot enforce on its own: a PATCH that moves only
    // `startAt` has no `dueAt` to compare against. The row always does.
    await expect(
      env.DB.prepare(
        "INSERT INTO todos (title, createdAt, updatedAt, projectId, startAt, dueAt) VALUES ('x','t','t',1,'2026-02-02','2026-02-01')",
      ).run(),
    ).rejects.toThrow();
  });

  it("has no `completed` column left", async () => {
    // The contract half of ADR 0011: once nothing reads it, the duplicate goes.
    // Two columns saying the same thing is the drift this replaced.
    const { results } = await env.DB.prepare("SELECT name FROM pragma_table_info('todos')").all<{
      name: string;
    }>();
    expect(results.map((r) => r.name)).not.toContain("completed");
  });

  it("indexes the todos that already existed when the index was created", async () => {
    // 0009 backfills. A migration that only starts indexing new rows leaves
    // every older todo permanently unfindable, which no query would report.
    const todos = await env.DB.prepare("SELECT count(*) AS n FROM todos").first<{ n: number }>();
    const indexed = await env.DB.prepare("SELECT count(*) AS n FROM todos_fts").first<{
      n: number;
    }>();
    expect(indexed?.n).toBe(todos?.n);
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

/**
 * The backfills are hard to reach from here: migrations run once, against an
 * empty database, before any of these tests. So the statement is read out of
 * the migration file and run against a state built here. Reading the file
 * rather than re-typing the SQL is the point — a copy would pass while the
 * shipped statement was wrong, which is exactly how 0019 got through.
 */
describe("giving an installation an owner", () => {
  async function seed(accounts: { id: string; role: string; createdAt: number }[]) {
    await env.DB.prepare("DELETE FROM user WHERE id LIKE 'backfill-%'").run();
    for (const account of accounts) {
      await env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at)
         VALUES (?, 'X', ?, 0, ?, ?, 0)`,
      )
        .bind(account.id, `${account.id}@example.invalid`, account.role, account.createdAt)
        .run();
    }
  }

  async function runBackfill() {
    // `--> statement-breakpoint` is drizzle's separator; this file has one
    // statement, and splitting on it keeps that from being an assumption.
    for (const statement of backfillOwner.split("--> statement-breakpoint")) {
      if (statement.trim()) await env.DB.prepare(statement).run();
    }
  }

  async function roleOf(id: string) {
    const row = await env.DB.prepare("SELECT role FROM user WHERE id = ?")
      .bind(id)
      .first<{ role: string }>();
    return row?.role;
  }

  afterEach(async () => {
    await env.DB.prepare("DELETE FROM user WHERE id LIKE 'backfill-%'").run();
  });

  it("promotes the earliest account when nobody is in charge", async () => {
    // The situation 0019 missed. `role` arrived in 0018 with DEFAULT 'member'
    // and no way to change it, so a database created between the two has
    // accounts, no administrator, and no owner — and cannot make one, because
    // the bootstrap only fires on an empty table.
    await seed([
      { id: "backfill-second", role: "member", createdAt: 200 },
      { id: "backfill-first", role: "member", createdAt: 100 },
    ]);

    await runBackfill();

    expect(await roleOf("backfill-first")).toBe("owner");
    expect(await roleOf("backfill-second")).toBe("member");
  });

  it("leaves an installation that already has one alone", async () => {
    await seed([
      { id: "backfill-first", role: "member", createdAt: 100 },
      { id: "backfill-owner", role: "owner", createdAt: 300 },
    ]);

    await runBackfill();

    expect(await roleOf("backfill-first")).toBe("member");
    expect(await roleOf("backfill-owner")).toBe("owner");
  });

  it("does nothing to an empty database, leaving the bootstrap to decide", async () => {
    await seed([]);

    await expect(runBackfill()).resolves.not.toThrow();
  });
});

describe("the project domain", () => {
  it("refuses a colour, a key or a span the application would never write", async () => {
    const insert = (columns: string, values: string) =>
      env.DB.prepare(
        `INSERT INTO projects (name, ownerId, createdAt, ${columns})
         VALUES ('p', (SELECT id FROM user LIMIT 1), '2026-01-01', ${values})`,
      ).run();

    await expect(insert("key, color", "'OK1', 'chartreuse'")).rejects.toThrow();
    // Lowercase and spaces do not survive being read out loud.
    await expect(insert("key", "'lower case'")).rejects.toThrow();
    await expect(
      insert("key, startAt, dueAt", "'OK2', '2026-12-31', '2026-01-01'"),
    ).rejects.toThrow();
  });
});
