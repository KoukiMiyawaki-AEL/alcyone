import { sql } from "drizzle-orm";

/**
 * What an account may do beyond its own data, weakest first.
 *
 * The order is the rank, and the rank is the rule: an account may only change
 * accounts below its own, and only to a role below its own — the one exception
 * being that an owner may appoint another owner. Written as an ordered list so
 * that "below" is a comparison rather than a table of special cases.
 *
 * `owner` is the instance's owner, not a project's. A project's owner is the
 * account that created it (`projects.ownerId`) and is a different thing at a
 * different scope; the screens say プロジェクトの作成者 for that one.
 */
export const USER_ROLES = ["member", "admin", "owner"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** How far up the list a role sits. Higher outranks lower. */
export const roleRank = (role: UserRole): number => USER_ROLES.indexOf(role);
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Better Auth's own tables.
 *
 * Generated from the installed `@better-auth/drizzle-adapter`'s schema
 * generator rather than transcribed from docs, so it matches the version in
 * `package.json` exactly. Regenerate after upgrading `better-auth`.
 *
 * Deliberate deviations from the generated output:
 *
 * 1. `.unique()` became `uniqueIndex()` — drizzle-kit's
 *    table-rebuild path re-emits indexes but silently drops table-level UNIQUE
 *    constraints, so a future rebuild would quietly lose the guarantee that two
 *    users cannot share an email. Behaviourally identical in SQLite.
 * 2. The generated `authRelations` (drizzle relations v2) block is omitted — the
 *    repository builds its own queries and never uses relational queries.
 *
 * `onDelete: "cascade"` is kept as generated, which is an exception to
 * The reasoning is recorded there; in short, this is library-owned schema whose
 * delete path we do not control, and `deleteUser` is disabled anyway. The
 * consequence to remember: rebuilding `user` would silently delete every
 * session and account, so that migration needs's detach/reattach.
 *
 * Note these tables use snake_case columns and integer millisecond timestamps,
 * unlike the ISO-8601 text this project uses elsewhere. That is Better Auth's
 * convention and is not worth fighting.
 */

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
    image: text("image"),
    /**
     * What this account may do beyond its own data.
     *
     * Added to Better Auth's table rather than kept in one of ours, because a
     * separate table would let a user exist with no row in it and force every
     * check to decide what that means. It is declared to Better Auth as an
     * additional field with `input: false` (src/worker/auth.ts): declared so a
     * hook can write it, `input: false` so no endpoint accepts it from a
     * request. The role is not the user's to set.
     *
     * `member` is the default and the overwhelming majority. An admin can reach
     * project membership everywhere and manage accounts below their own rank.
     * An owner is an admin who can also appoint and remove admins and owners,
     * and the last one of whom cannot be removed at all.
     */
    role: text("role").notNull().default("member").$type<UserRole>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("user_email_uidx").on(table.email)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_uidx").on(table.token),
    index("session_userId_idx").on(table.userId),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("account_issuer_accountId_uidx").on(table.issuer, table.accountId),
    index("account_userId_idx").on(table.userId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
