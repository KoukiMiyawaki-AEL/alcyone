import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";

import { type Cursor } from "./cursor";
import { ftsRank, toFtsQuery, toLikePattern, todosFts } from "./fts";
import {
  TODO_STATUSES,
  attachmentsTable,
  projectMembersTable,
  type UserRole,
  todoLinksTable,
  type TodoLinkKind,
  user,
  todoCommentsTable,
  todoEventsTable,
  projectsTable,
  sharesTable,
  todosTable,
  type TodoStatus,
} from "./schema";

/**
 * Timestamps are generated here, not by the database.
 *
 * SQLite's `current_timestamp` produces `2026-08-23 12:44:13` — UTC, but not
 * ISO-8601, which `new Date()` then reads as local time. Generating them in
 * app code keeps one format that both SQL and JS agree on.
 */
const now = () => new Date().toISOString();

/**
 * Identifies one save.
 *
 * `crypto.randomUUID`, not a timestamp: two saves in the same millisecond would
 * merge into one entry, and grouping by a coincidence of equal clocks is not
 * something the data would ever say out loud. A generated id states it.
 */
const newRevisionId = () => crypto.randomUUID();

/**
 * How far the ancestor walk goes before giving up.
 *
 * A bound, not a product rule: a cycle that somehow already exists must not be
 * able to hang the request that is trying to prevent another one.
 */
const MAX_DEPTH = 50;

/**
 * What a list is narrowed to. Distinct from `TodoStatus` in the schema, which
 * is what a single row *is* — one of these ("active") is not a status at all
 * but "anything unfinished", and conflating the two is how a filter ends up
 * silently unable to express a state.
 */
export type TodoFilter = "all" | "active" | (typeof TODO_STATUSES)[number];
/**
 * The fields a caller may set on a todo. Optional throughout, and `null` where
 * clearing is meaningful — `undefined` means "leave it", `null` means "empty
 * it".
 */
/** The fields whose changes are worth a history row. See TODO_EVENT_FIELDS. */
const TRACKED_FIELDS = [
  "status",
  "assigneeId",
  "parentId",
  "startAt",
  "dueAt",
  "title",
  "priority",
] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];

export type TodoFields = {
  title?: string;
  status?: TodoStatus;
  /** `null` unassigns. Absent leaves it alone, like every other field here. */
  assigneeId?: string | null;
  /** `null` makes it top level. */
  parentId?: number | null;
  startAt?: string | null;
  dueAt?: string | null;
  description?: string | null;
  priority?: number;
};

export type TodoSort = "created" | "due" | "priority" | "start";
export type TodoListOptions = {
  status?: TodoFilter;
  sort?: TodoSort;
  cursor?: Cursor | null;
  limit?: number;
};

/** The column a given sort orders by, and how to read it off a row. */
const sortColumn = {
  created: todosTable.id,
  due: todosTable.dueAt,
  start: todosTable.startAt,
  priority: todosTable.priority,
} as const;

export const todoCursorValue = (
  sort: TodoSort,
  row: { id: number; startAt: string | null; dueAt: string | null; priority: number },
) =>
  sort === "due"
    ? row.dueAt
    : sort === "start"
      ? row.startAt
      : sort === "priority"
        ? row.priority
        : row.id;

/**
 * "Everything after this position", expressed for the active sort.
 *
 * The `or` is the part that matters: rows sharing a sort value are separated by
 * id, so a page boundary that lands in the middle of a group neither repeats
 * nor skips them.
 */
function afterCursor(sort: TodoSort, cursor: Cursor): SQL | undefined {
  if (sort === "created") return gt(todosTable.id, cursor.id);

  const column = sortColumn[sort];
  if (sort === "priority") {
    // Descending, so "after" means a lower priority.
    return or(
      sql`${column} < ${cursor.value}`,
      and(eq(column, cursor.value as number), gt(todosTable.id, cursor.id)),
    );
  }

  // A date column ascending with nulls last — `due` and `start` behave
  // identically here. A null cursor is already in the trailing group, so only
  // ids can move it forward.
  if (cursor.value === null) {
    return and(sql`${column} is null`, gt(todosTable.id, cursor.id));
  }
  return or(
    sql`${column} is null`,
    sql`${column} > ${cursor.value}`,
    and(eq(column, cursor.value as string), gt(todosTable.id, cursor.id)),
  );
}

const statusFilter = (filter: TodoFilter = "all"): SQL | undefined => {
  if (filter === "all") return undefined;
  // "active" is every state except the terminal one, so it keeps meaning the
  // right thing when another state is added.
  if (filter === "active") return ne(todosTable.status, "done");
  return eq(todosTable.status, filter);
};

const sortOrder = (sort: TodoSort = "created"): SQL[] => {
  switch (sort) {
    case "due":
      // The first term is what pushes undated todos to the end. Left to
      // itself SQLite sorts NULL lowest, which would present "no deadline" as
      // the most urgent thing on the list.
      return [sql`${todosTable.dueAt} is null`, asc(todosTable.dueAt)];
    case "start":
      // Same nulls-last reasoning as `due`: a task with no start date is not
      // the one to begin with.
      return [sql`${todosTable.startAt} is null`, asc(todosTable.startAt)];
    case "priority":
      return [desc(todosTable.priority)];
    case "created":
      return [];
  }
};

/**
 * The single place `drizzle()` is constructed, the single place a query against
 * a table is written, and — since auth landed — the single place ownership is
 * enforced.
 *
 * **Every method here is already scoped to `ownerId`.** That is the point: a
 * handler cannot forget the filter because it never receives an unscoped query.
 * Getting this wrong produces no type error and no failing test; it produces one
 * user reading another user's rows.
 *
 * The same applies to soft deletion: every read also filters `deletedAt IS
 * NULL`, and that filter lives only here. Two invisible filters on every query
 * is exactly the situation this module exists to make un-forgettable.
 *
 * Note what that costs for todos. Todos have no owner column of their own —
 * ownership is transitive through their project — so the two flat routes
 * (`PATCH`/`DELETE /api/todos/:id`) must constrain through a subquery on
 * `projects`. Before auth those two matched on `todos.id` alone, which would
 * have let anyone walk the integer id space and edit other people's rows.
 *
 * D1 has no interactive transactions — `db.transaction()` type-checks and then
 * throws at runtime. The only atomicity primitive is `batch()`.
 *
 * IMPORTANT: these methods must never be `async`, and must not call `.all()` /
 * `.get()`. They return the *unexecuted* drizzle builder, which is both
 * awaitable (it extends QueryPromise) and usable as a `batch()` item. An
 * `async` wrapper would auto-await the builder and silently destroy the second
 * property.
 */
/**
 * `D1DatabaseSession` is accepted alongside `D1Database` because drizzle only
 * needs `prepare` and `batch`, which both provide. Handlers pass the session so
 * their reads are consistent with their own writes; the cron passes the plain
 * database, having no user whose writes to be consistent with.
 */
export function createRepo(
  binding: D1Database | D1DatabaseSession,
  ownerId: string,
  role: UserRole = "member",
) {
  // Read once. Threading the role through every subquery would put the same
  // decision in fourteen places, which is the shape that lets one of them
  // disagree.
  const isAdmin = role === "admin";
  const db = drizzle(binding as D1Database);

  /**
   * Projects this account may *administer*: rename, delete, share, or change
   * who is on them.
   *
   * Ownership, plus the admin role. Kept separate from `accessibleProjectIds`
   * on purpose — a member can work on the tasks without being able to give
   * someone else the keys, and collapsing the two would quietly hand every
   * member that power.
   */
  const ownedProjectIds = (id?: number) =>
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(
        and(
          isAdmin ? undefined : eq(projectsTable.ownerId, ownerId),
          isNull(projectsTable.deletedAt),
          id === undefined ? undefined : eq(projectsTable.id, id),
        ),
      );

  /**
   * Projects whose tasks this account may read and change.
   *
   * Owner, member, or admin. **This is the one place the boundary is drawn**,
   * which is what made adding membership a change to one function rather than
   * to fourteen call sites — the reason ADR 0014 put the scoping here.
   */
  const accessibleProjectIds = (id?: number) =>
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(
        and(
          isAdmin
            ? undefined
            : or(
                eq(projectsTable.ownerId, ownerId),
                inArray(
                  projectsTable.id,
                  db
                    .select({ id: projectMembersTable.projectId })
                    .from(projectMembersTable)
                    .where(eq(projectMembersTable.userId, ownerId)),
                ),
              ),
          isNull(projectsTable.deletedAt),
          id === undefined ? undefined : eq(projectsTable.id, id),
        ),
      );

  /** Live todos this owner can reach. Comments hang off it. */
  const ownedTodoIdsForComments = () =>
    db
      .select({ id: todosTable.id })
      .from(todosTable)
      .where(
        and(isNull(todosTable.deletedAt), inArray(todosTable.projectId, accessibleProjectIds())),
      );

  /**
   * Records one field's change, but only if it is actually changing.
   *
   * An INSERT ... SELECT with the comparison in its WHERE: no row is selected
   * when the value already matches, so nothing is inserted. That matters
   * because the detail form submits every field on every save — a naive
   * "record what was asked for" would bury one real change under five
   * non-changes.
   *
   * Ownership is in the SELECT too. Nothing here is reachable without it, but
   * a history table that could be written for someone else's todo would be a
   * way to learn their ids.
   */
  const changeEvent = (
    todoId: number,
    revisionId: string,
    field: TrackedField,
    to: string | number | null,
  ) => {
    const column = todosTable[field];
    const next = to === null ? null : String(to);

    return db.insert(todoEventsTable).select(
      db
        .select({
          // Selected explicitly and in table order: drizzle requires an
          // insert-from-select to name every column. `null` into an INTEGER
          // PRIMARY KEY is what makes SQLite assign the next id.
          id: sql<number>`null`.as("id"),
          todoId: todosTable.id,
          actorId: sql<string>`${ownerId}`.as("actorId"),
          revisionId: sql<string>`${revisionId}`.as("revisionId"),
          field: sql<string>`${field}`.as("field"),
          fromValue: sql<string | null>`${column}`.as("fromValue"),
          toValue: sql<string | null>`${next}`.as("toValue"),
          createdAt: sql<string>`${now()}`.as("createdAt"),
        })
        .from(todosTable)
        .where(
          and(
            eq(todosTable.id, todoId),
            isNull(todosTable.deletedAt),
            // `is not` rather than `<>`: SQL's inequality is null-propagating,
            // so `<>` would never record a date being set or cleared.
            sql`${column} is not ${next}`,
            inArray(todosTable.projectId, accessibleProjectIds()),
          ),
        ),
    );
  };

  const lifecycleEvent = (
    todoId: number,
    revisionId: string,
    field: "created" | "deleted" | "restored",
  ) =>
    db.insert(todoEventsTable).select(
      db
        .select({
          id: sql<number>`null`.as("id"),
          todoId: todosTable.id,
          actorId: sql<string>`${ownerId}`.as("actorId"),
          revisionId: sql<string>`${revisionId}`.as("revisionId"),
          field: sql<string>`${field}`.as("field"),
          fromValue: sql<string | null>`null`.as("fromValue"),
          toValue: sql<string | null>`null`.as("toValue"),
          createdAt: sql<string>`${now()}`.as("createdAt"),
        })
        .from(todosTable)
        .where(
          and(eq(todosTable.id, todoId), inArray(todosTable.projectId, accessibleProjectIds())),
        ),
    );

  const comments = {
    /**
     * Joined to `user` so a comment arrives with a name on it.
     *
     * Resolved here rather than by the client looking up the session's own
     * name: today every author is the signed-in user, so the two agree — and
     * a rule that holds by coincidence is the one that breaks silently the
     * day a project has two people on it.
     */
    listByTodo: (todoId: number) =>
      db
        .select({
          id: todoCommentsTable.id,
          todoId: todoCommentsTable.todoId,
          authorId: todoCommentsTable.authorId,
          authorName: user.name,
          body: todoCommentsTable.body,
          revisionId: todoCommentsTable.revisionId,
          createdAt: todoCommentsTable.createdAt,
          updatedAt: todoCommentsTable.updatedAt,
        })
        .from(todoCommentsTable)
        .innerJoin(user, eq(user.id, todoCommentsTable.authorId))
        .where(
          and(
            eq(todoCommentsTable.todoId, todoId),
            isNull(todoCommentsTable.deletedAt),
            inArray(todoCommentsTable.todoId, ownedTodoIdsForComments()),
          ),
        )
        .orderBy(asc(todoCommentsTable.id)),

    /**
     * Insert-from-select, so the todo's ownership is part of the statement, and
     * a builder rather than raw SQL so it can go in a batch.
     *
     * A plain insert would satisfy the foreign key for *any* existing todo — a
     * foreign key checks existence, not ownership, which is how a public share
     * link for someone else's project once became possible (ADR 0022). And raw
     * `db.run()` is not batchable: it type-checks and throws when batched,
     * which is how the first version of the history failed.
     */
    create: (todoId: number, body: string, revisionId: string | null = null) =>
      db
        .insert(todoCommentsTable)
        .select(
          db
            .select({
              // Named in table order, `null` into the primary key so SQLite
              // assigns the next one. drizzle requires every column.
              id: sql<number>`null`.as("id"),
              todoId: todosTable.id,
              authorId: sql<string>`${ownerId}`.as("authorId"),
              body: sql<string>`${body}`.as("body"),
              revisionId: sql<string | null>`${revisionId}`.as("revisionId"),
              createdAt: sql<string>`${now()}`.as("createdAt"),
              updatedAt: sql<string>`${now()}`.as("updatedAt"),
              deletedAt: sql<string | null>`null`.as("deletedAt"),
            })
            .from(todosTable)
            .where(
              and(
                eq(todosTable.id, todoId),
                isNull(todosTable.deletedAt),
                inArray(todosTable.projectId, accessibleProjectIds()),
              ),
            ),
        )
        .returning({ id: todoCommentsTable.id }),

    find: (id: number) =>
      db
        .select()
        .from(todoCommentsTable)
        .where(
          and(
            eq(todoCommentsTable.id, id),
            isNull(todoCommentsTable.deletedAt),
            inArray(todoCommentsTable.todoId, ownedTodoIdsForComments()),
          ),
        ),

    /**
     * Only the author may edit. Today that is always the owner, so the two
     * conditions are the same one — but they will stop being the same the day
     * a project has more than one person on it, and a rule that only holds by
     * coincidence is not a rule.
     */
    update: (id: number, body: string) =>
      db
        .update(todoCommentsTable)
        .set({ body, updatedAt: now() })
        .where(
          and(
            eq(todoCommentsTable.id, id),
            eq(todoCommentsTable.authorId, ownerId),
            isNull(todoCommentsTable.deletedAt),
            inArray(todoCommentsTable.todoId, ownedTodoIdsForComments()),
          ),
        )
        .returning(),

    remove: (id: number) =>
      db
        .update(todoCommentsTable)
        .set({ deletedAt: now() })
        .where(
          and(
            eq(todoCommentsTable.id, id),
            eq(todoCommentsTable.authorId, ownerId),
            isNull(todoCommentsTable.deletedAt),
            inArray(todoCommentsTable.todoId, ownedTodoIdsForComments()),
          ),
        )
        .returning(),
  };

  /**
   * Who a task on this project may be assigned to.
   *
   * A query rather than "it is you": today it returns exactly one row, because
   * a project has one owner (ADR 0014). Having the client ask instead of
   * assuming means the list grows on its own the day a project has members,
   * and means nothing has to be found and corrected then.
   */
  const members = {
    /** Who is on a project, owner first. Readable by anyone who can reach it. */
    forProject: (projectId: number) =>
      db
        .select({
          id: projectMembersTable.id,
          userId: projectMembersTable.userId,
          name: user.name,
          email: user.email,
          createdAt: projectMembersTable.createdAt,
        })
        .from(projectMembersTable)
        .innerJoin(user, eq(user.id, projectMembersTable.userId))
        .where(inArray(projectMembersTable.projectId, accessibleProjectIds(projectId)))
        .orderBy(asc(projectMembersTable.id)),

    /**
     * Adds someone, scoped to projects this account may *administer*.
     *
     * Insert-from-select, so the permission is part of the statement: a member
     * who could add members would be a member who can hand out access, which is
     * the one thing the owner/member distinction exists to prevent. A foreign
     * key would not have caught it — it checks that the project exists.
     */
    add: (projectId: number, userId: string) =>
      db.all<{ id: number }>(sql`
        insert into ${projectMembersTable} ("projectId", "userId", "addedBy", "createdAt")
        select ${projectsTable.id}, ${userId}, ${ownerId}, ${now()}
        from ${projectsTable}
        where ${projectsTable.id} in ${ownedProjectIds(projectId)}
          -- The owner's access already comes from projects.ownerId; a row here
          -- would be a second fact that can disagree with the first.
          and ${projectsTable.ownerId} <> ${userId}
        returning id
      `),

    /**
     * Adds by email address rather than by id.
     *
     * The directory is an administrator's to see, which left an ordinary owner
     * with a member list and no way to add to it. An address is something the
     * person inviting already knows, so accepting one grants no knowledge —
     * unlike a list of everyone.
     *
     * It does let someone learn whether an address has an account, one guess at
     * a time, which is why this route is rate limited. Refusing to say anything
     * would mean an owner cannot tell "wrong address" from "already a member",
     * and would not stop the probing either.
     */
    addByEmail: (projectId: number, email: string) =>
      db.all<{ id: number }>(sql`
        insert into ${projectMembersTable} ("projectId", "userId", "addedBy", "createdAt")
        select ${projectsTable.id}, ${user.id}, ${ownerId}, ${now()}
        from ${projectsTable}, ${user}
        where ${projectsTable.id} in ${ownedProjectIds(projectId)}
          and ${user.email} = ${email}
          -- The owner's access already comes from projects.ownerId.
          and ${projectsTable.ownerId} <> ${user.id}
        returning id
      `),

    remove: (projectId: number, userId: string) =>
      db
        .delete(projectMembersTable)
        .where(
          and(
            eq(projectMembersTable.userId, userId),
            inArray(projectMembersTable.projectId, ownedProjectIds(projectId)),
          ),
        )
        .returning({ id: projectMembersTable.id }),
  };

  const roles = {
    /**
     * Changes what an account may do. Administrators only.
     *
     * Refuses to remove the last administrator: the role can only be granted by
     * someone who holds it, so an installation with none has no way back short
     * of a database console. The check and the write are one statement, because
     * two would leave a window where both of the last two admins demote each
     * other.
     */
    set: (userId: string, role: UserRole) => {
      if (!isAdmin)
        return db
          .select({ id: user.id })
          .from(user)
          .where(sql`0 = 1`);

      // Only demotion can strip the last one, and only if the target holds the
      // role now. Written as a builder rather than raw SQL because SQLite
      // rejects a qualified column on the left of `SET`, which is what
      // interpolating the column into a template produces.
      const survives =
        role === "admin"
          ? undefined
          : or(
              ne(user.role, "admin"),
              sql`(select count(*) from ${user} where ${user.role} = 'admin') > 1`,
            );

      return db
        .update(user)
        .set({ role })
        .where(and(eq(user.id, userId), survives))
        .returning({ id: user.id });
    },
  };

  /**
   * Accounts that can be invited.
   *
   * Only an administrator sees this: handing every user a list of every other
   * user's name and address is a directory, and nobody asked for one.
   */
  const directory = {
    list: () =>
      isAdmin
        ? db
            .select({ id: user.id, name: user.name, email: user.email, role: user.role })
            .from(user)
            .orderBy(asc(user.name))
        : db
            .select({ id: user.id, name: user.name, email: user.email, role: user.role })
            .from(user)
            .where(sql`0 = 1`),
  };

  const assignees = {
    /**
     * Everyone who can reach the project: its owner and its members.
     *
     * Written as a union rather than a join, because the owner's access comes
     * from a column and a member's from a row — the same fact reached two ways,
     * which is exactly why the owner is not duplicated into the members table.
     */
    forProject: (projectId: number) =>
      db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(
          and(
            inArray(
              user.id,
              db
                .select({ id: projectsTable.ownerId })
                .from(projectsTable)
                .where(inArray(projectsTable.id, accessibleProjectIds(projectId)))
                .union(
                  db
                    .select({ id: projectMembersTable.userId })
                    .from(projectMembersTable)
                    .where(inArray(projectMembersTable.projectId, accessibleProjectIds(projectId))),
                ),
            ),
          ),
        )
        .orderBy(asc(user.name)),
  };

  /**
   * Would making `parentId` the parent of `todoId` create a loop?
   *
   * SQLite cannot express "not an ancestor of itself" as a constraint, so it is
   * a query: walk up from the proposed parent and see whether the task itself
   * appears. A recursive CTE rather than repeated round trips, and bounded to
   * `MAX_DEPTH` so a cycle that somehow already exists cannot spin forever —
   * the guard has to survive the corruption it is guarding against.
   */
  const wouldCycle = async (todoId: number, parentId: number): Promise<boolean> => {
    if (todoId === parentId) return true;

    const { results } = await binding
      .prepare(
        `with recursive ancestors(id, depth) as (
           select parentId, 1 from todos where id = ?1 and parentId is not null
           union all
           select t.parentId, a.depth + 1
             from todos t join ancestors a on t.id = a.id
            where t.parentId is not null and a.depth < ?3
         )
         select 1 as hit from ancestors where id = ?2 limit 1`,
      )
      .bind(parentId, todoId, MAX_DEPTH)
      .all();

    return results.length > 0;
  };

  const links = {
    /** Both directions in one query: `related` is stored once, not twice. */
    forTodo: (todoId: number) =>
      db
        .select({
          id: todoLinksTable.id,
          kind: todoLinksTable.kind,
          fromTodoId: todoLinksTable.fromTodoId,
          toTodoId: todoLinksTable.toTodoId,
        })
        .from(todoLinksTable)
        .where(
          and(
            or(eq(todoLinksTable.fromTodoId, todoId), eq(todoLinksTable.toTodoId, todoId)),
            inArray(todoLinksTable.fromTodoId, allOwnedTodoIds()),
            inArray(todoLinksTable.toTodoId, allOwnedTodoIds()),
          ),
        )
        .orderBy(asc(todoLinksTable.id)),

    /**
     * Insert-from-select over both endpoints, so ownership of *each* task is
     * part of the statement. Checking only one would let a link reach out of
     * the account and, by succeeding or failing, report whether an id exists.
     */
    create: (fromTodoId: number, toTodoId: number, kind: TodoLinkKind) =>
      db.all<{ id: number }>(sql`
        insert into ${todoLinksTable} ("fromTodoId", "toTodoId", "kind", "createdAt")
        select ${fromTodoId}, ${toTodoId}, ${kind}, ${now()}
        where ${fromTodoId} in ${allOwnedTodoIds()}
          and ${toTodoId} in ${allOwnedTodoIds()}
        returning id
      `),

    remove: (id: number) =>
      db
        .delete(todoLinksTable)
        .where(
          and(
            eq(todoLinksTable.id, id),
            inArray(todoLinksTable.fromTodoId, allOwnedTodoIds()),
            inArray(todoLinksTable.toTodoId, allOwnedTodoIds()),
          ),
        )
        .returning({ id: todoLinksTable.id }),
  };

  const events = {
    listByTodo: (todoId: number) =>
      db
        .select({
          id: todoEventsTable.id,
          todoId: todoEventsTable.todoId,
          actorId: todoEventsTable.actorId,
          actorName: user.name,
          revisionId: todoEventsTable.revisionId,
          field: todoEventsTable.field,
          fromValue: todoEventsTable.fromValue,
          toValue: todoEventsTable.toValue,
          createdAt: todoEventsTable.createdAt,
        })
        .from(todoEventsTable)
        .innerJoin(user, eq(user.id, todoEventsTable.actorId))
        .where(
          and(
            eq(todoEventsTable.todoId, todoId),
            // Deliberately not filtered by the todo being live: the history of
            // a deleted-then-restored task is exactly when it is worth reading.
            inArray(
              todoEventsTable.todoId,
              db
                .select({ id: todosTable.id })
                .from(todosTable)
                .where(inArray(todosTable.projectId, accessibleProjectIds())),
            ),
          ),
        )
        .orderBy(asc(todoEventsTable.id)),
  };

  const shares = {
    find: (projectId: number) =>
      db
        .select()
        .from(sharesTable)
        .where(inArray(sharesTable.projectId, ownedProjectIds(projectId)))
        .limit(1),

    /**
     * Insert-from-select, so ownership is part of the statement rather than a
     * check the caller is trusted to have done.
     *
     * A plain insert passes the foreign key for *any* existing project, because
     * a foreign key checks existence and not ownership — which meant any signed
     * in user could mint a public link to a stranger's project. A test caught
     * it. The select yields no row when the project is not this owner's, so
     * nothing is inserted and the caller sees the same "not found" as for an id
     * that never existed.
     *
     * Written as SQL because drizzle's insert-select requires the selected
     * columns to match the table definition exactly, including the
     * autoincrement id — which would mean naming a column precisely to avoid
     * setting it.
     */
    create: (projectId: number, token: string) =>
      db.all<{ token: string }>(sql`
        insert into ${sharesTable} (token, "projectId", "createdAt")
        select ${token}, ${projectsTable.id}, ${now()}
        from ${projectsTable}
        where ${projectsTable.id} = ${projectId}
          and ${projectsTable.ownerId} = ${ownerId}
          and ${projectsTable.deletedAt} is null
        returning token
      `),

    remove: (projectId: number) =>
      db
        .delete(sharesTable)
        .where(inArray(sharesTable.projectId, ownedProjectIds(projectId)))
        .returning({ token: sharesTable.token }),
  };

  const projects = {
    list: (options: { cursor?: Cursor | null; limit?: number } = {}) =>
      db
        .select()
        .from(projectsTable)
        .where(
          and(
            // Everything reachable, not everything owned: a project someone
            // invited you to is one of yours as far as this screen is
            // concerned, and hiding it would leave no way in.
            inArray(projectsTable.id, accessibleProjectIds()),
            isNull(projectsTable.deletedAt),
            options.cursor ? gt(projectsTable.id, options.cursor.id) : undefined,
          ),
        )
        .orderBy(asc(projectsTable.id))
        .limit((options.limit ?? 0) + 1),

    /**
     * Reachable, not owned. This answers "may I work here", and a member may.
     * Deleting and sharing use the narrower scope; those are different
     * questions with different answers.
     */
    find: (id: number) =>
      db
        .select()
        .from(projectsTable)
        .where(
          and(
            eq(projectsTable.id, id),
            inArray(projectsTable.id, accessibleProjectIds()),
            isNull(projectsTable.deletedAt),
          ),
        ),

    create: (values: { name: string }) =>
      db
        .insert(projectsTable)
        .values({ ...values, ownerId, createdAt: now() })
        .returning(),

    /** Soft delete. The row stays so it can be restored. */
    /** Owner or admin only: deleting a project is not a member's to do. */
    remove: (id: number) =>
      db
        .update(projectsTable)
        .set({ deletedAt: now() })
        .where(
          and(
            eq(projectsTable.id, id),
            inArray(projectsTable.id, ownedProjectIds()),
            isNull(projectsTable.deletedAt),
          ),
        )
        .returning(),

    restore: (id: number) =>
      db.update(projectsTable).set({ deletedAt: null }).where(eq(projectsTable.id, id)).returning(),
  };

  const todos = {
    find: (id: number) =>
      db
        .select()
        .from(todosTable)
        .where(
          and(
            eq(todosTable.id, id),
            isNull(todosTable.deletedAt),
            inArray(todosTable.projectId, accessibleProjectIds()),
          ),
        ),

    listByProject: (projectId: number, options: TodoListOptions = {}) =>
      db
        .select()
        .from(todosTable)
        .where(
          and(
            inArray(todosTable.projectId, accessibleProjectIds(projectId)),
            isNull(todosTable.deletedAt),
            statusFilter(options.status),
            options.cursor ? afterCursor(options.sort ?? "created", options.cursor) : undefined,
          ),
        )
        // One more than asked for: the extra row is how the caller learns
        // whether another page exists without a second count query, which on
        // D1 would double the rows read.
        .limit((options.limit ?? 0) + 1)
        // Always a tiebreaker on id: without one, two todos with the same due
        // date or priority can swap places between requests, which looks like
        // the list is shuffling itself.
        .orderBy(...sortOrder(options.sort), asc(todosTable.id)),

    create: (values: TodoFields & { title: string; projectId: number }) => {
      const timestamp = now();
      return db
        .insert(todosTable)
        .values({ ...values, createdAt: timestamp, updatedAt: timestamp })
        .returning();
    },

    /**
     * Partial update. Only the keys present are written, so clearing a date
     * (`null`) and leaving it alone (absent) stay distinguishable — collapsing
     * them would make "remove the due date" impossible to express.
     */
    update: (id: number, values: TodoFields) =>
      db
        .update(todosTable)
        .set({ ...values, updatedAt: now() })
        .where(
          and(
            eq(todosTable.id, id),
            isNull(todosTable.deletedAt),
            inArray(todosTable.projectId, accessibleProjectIds()),
          ),
        )
        .returning(),

    /** The opening entry of a task's history. */
    createdEvent: (id: number) =>
      [lifecycleEvent(id, newRevisionId(), "created")] as unknown as [
        BatchItem<"sqlite">,
        ...BatchItem<"sqlite">[],
      ],

    /**
     * Records a lifecycle event alongside a soft delete or restore.
     *
     * The event goes *after* the change here, not before: unlike a field
     * change it reads nothing that the change destroys, and putting it second
     * means a failed delete leaves no history claiming it happened.
     */
    removeWithHistory: (id: number) =>
      [todos.remove(id), lifecycleEvent(id, newRevisionId(), "deleted")] as unknown as [
        BatchItem<"sqlite">,
        ...BatchItem<"sqlite">[],
      ],

    restoreWithHistory: (id: number) =>
      [todos.restore(id), lifecycleEvent(id, newRevisionId(), "restored")] as unknown as [
        BatchItem<"sqlite">,
        ...BatchItem<"sqlite">[],
      ],

    /**
     * The change, and the record of it, as one batch. **The updated rows are
     * the last result.**
     *
     * The history rows come first, and that ordering is the whole design: each
     * one reads the value it is about to replace, which stops existing the
     * moment the UPDATE runs.
     *
     * Reading the row in the handler and diffing it there would have been the
     * obvious shape, and wrong twice over. It costs a round trip, and between
     * the read and the write another request can change the same row — the
     * history would then record a transition that never happened. Doing the
     * comparison inside each INSERT ... SELECT means the old value is read at
     * the instant it is used, with no window in between.
     *
     * `db.transaction()` is not an option and is worth naming: it type-checks
     * and fails at runtime, because D1 has no interactive transactions. This is
     * the case the readiness map recorded as D5 before there was any history to
     * write.
     */
    updateWithHistory: (id: number, values: TodoFields, comment?: string) => {
      // One id for the whole save, so the rows it writes read as one action
      // rather than as several that happened to coincide.
      const revisionId = newRevisionId();

      const events = TRACKED_FIELDS.filter((field) => values[field] !== undefined).map((field) =>
        changeEvent(id, revisionId, field, values[field] ?? null),
      );

      // A comment written with a change carries the same revision, which is
      // what lets the screen show "moved to blocked" and the reason for it as
      // one entry instead of two things that happened at the same time.
      const note = comment === undefined ? [] : [comments.create(id, comment, revisionId)];

      // Always at least the update, so the tuple is never empty — which is what
      // `batch()` requires and what this asserts. Through `unknown` because a
      // raw statement and an update builder share no structural shape, not
      // because either is the wrong thing to put in a batch.
      return [...events, ...note, todos.update(id, values)] as unknown as [
        BatchItem<"sqlite">,
        ...BatchItem<"sqlite">[],
      ];
    },

    setStatus: (id: number, status: TodoStatus) =>
      db
        .update(todosTable)
        .set({ status, updatedAt: now() })
        .where(
          and(
            eq(todosTable.id, id),
            isNull(todosTable.deletedAt),
            inArray(todosTable.projectId, accessibleProjectIds()),
          ),
        )
        .returning(),

    /** Soft delete. The row stays so it can be restored. */
    remove: (id: number) =>
      db
        .update(todosTable)
        .set({ deletedAt: now() })
        .where(
          and(
            eq(todosTable.id, id),
            isNull(todosTable.deletedAt),
            inArray(todosTable.projectId, accessibleProjectIds()),
          ),
        )
        .returning(),

    restore: (id: number) =>
      db
        .update(todosTable)
        .set({ deletedAt: null })
        .where(and(eq(todosTable.id, id), inArray(todosTable.projectId, accessibleProjectIds())))
        .returning(),

    /** Soft-deletes a project's todos alongside it. */
    removeByProject: (projectId: number) =>
      db
        .update(todosTable)
        .set({ deletedAt: now() })
        .where(
          and(
            inArray(todosTable.projectId, accessibleProjectIds(projectId)),
            isNull(todosTable.deletedAt),
          ),
        ),

    restoreByProject: (projectId: number) =>
      db
        .update(todosTable)
        .set({ deletedAt: null })
        .where(inArray(todosTable.projectId, accessibleProjectIds(projectId))),

    /**
     * Full-text search across every project this user owns.
     *
     * Two paths, one shape. `toFtsQuery` returns null when nothing the user
     * typed is long enough to match a trigram, and then this scans with LIKE
     * instead. That path is the expensive one — D1 bills rows scanned and LIKE
     * cannot use an index — which is exactly why it is the fallback and not
     * the implementation.
     *
     * Both are scoped through `ownedProjectIds()` like everything else here.
     * The index itself is not scoped: it holds every user's titles, so
     * forgetting the join would leak other people's todos. A test covers it.
     */
    search: (query: string, options: { cursor?: Cursor | null; limit?: number } = {}) => {
      const match = toFtsQuery(query);
      const limit = (options.limit ?? 0) + 1;

      if (match === null) {
        return (
          db
            // A constant rank so both paths hand back the same shape. The LIKE
            // path has no relevance to report, and pretending otherwise would be
            // worse than admitting every hit is equally good.
            .select({ ...getTableColumns(todosTable), rank: sql<number>`0` })
            .from(todosTable)
            .where(
              and(
                inArray(todosTable.projectId, accessibleProjectIds()),
                isNull(todosTable.deletedAt),
                // Both columns, to match what the FTS path searches. A short
                // query finding fewer things than a long one would be a strange
                // rule to explain.
                or(
                  sql`${todosTable.title} LIKE ${toLikePattern(query)} ESCAPE '\\'`,
                  sql`${todosTable.description} LIKE ${toLikePattern(query)} ESCAPE '\\'`,
                ),
                options.cursor ? gt(todosTable.id, options.cursor.id) : undefined,
              ),
            )
            .limit(limit)
            .orderBy(asc(todosTable.id))
        );
      }

      return db
        .select({ ...getTableColumns(todosTable), rank: ftsRank })
        .from(todosTable)
        .innerJoin(todosFts, eq(todosFts.rowid, todosTable.id))
        .where(
          and(
            sql`${todosFts} MATCH ${match}`,
            inArray(todosTable.projectId, accessibleProjectIds()),
            isNull(todosTable.deletedAt),
            // Keyset on relevance. Possible only because bm25() is usable in
            // WHERE, which was measured rather than assumed. The id tiebreak
            // matters more here than elsewhere: with trigrams, equal scores are
            // the common case, not the exception.
            options.cursor
              ? or(
                  gt(ftsRank, options.cursor.value),
                  and(eq(ftsRank, options.cursor.value), gt(todosTable.id, options.cursor.id)),
                )
              : undefined,
          ),
        )
        .limit(limit)
        .orderBy(asc(ftsRank), asc(todosTable.id));
    },
  };

  /**
   * Hard-deletes everything this owner has, soft-deleted rows included.
   *
   * This is the one place that ignores `deletedAt` — account deletion has to
   * mean deletion, or "delete my data" is a lie. Children first: `projects`
   * is referenced by `todos`, and D1 enforces the foreign key.
   *
   * Returns statements rather than running them, so the caller can put the
   * user row's own deletion in the same batch.
   */
  /** Every todo id owned by this user, ignoring soft-delete state. */
  const allOwnedTodoIds = () =>
    db
      .select({ id: todosTable.id })
      .from(todosTable)
      .where(
        inArray(
          todosTable.projectId,
          db
            .select({ id: projectsTable.id })
            .from(projectsTable)
            .where(eq(projectsTable.ownerId, ownerId)),
        ),
      );

  const purgeOwnedData = () =>
    [
      // Three levels now — attachments reference todos, todos reference
      // projects — so three statements in dependency order. The R2 objects are
      // not rows and survive this; see ownedAttachmentKeys.
      db.delete(attachmentsTable).where(inArray(attachmentsTable.todoId, allOwnedTodoIds())),
      db.delete(todoLinksTable).where(inArray(todoLinksTable.fromTodoId, allOwnedTodoIds())),
      db.delete(todoCommentsTable).where(inArray(todoCommentsTable.todoId, allOwnedTodoIds())),
      db.delete(todoEventsTable).where(inArray(todoEventsTable.todoId, allOwnedTodoIds())),
      // Detach before deleting. `todos.parentId` points into `todos`, and
      // SQLite checks the foreign key row by row — a delete that removes a
      // parent before its child fails on the child still pointing at it.
      db
        .update(todosTable)
        .set({ parentId: null })
        .where(inArray(todosTable.id, allOwnedTodoIds())),
      db
        .delete(sharesTable)
        .where(
          inArray(
            sharesTable.projectId,
            db
              .select({ id: projectsTable.id })
              .from(projectsTable)
              .where(eq(projectsTable.ownerId, ownerId)),
          ),
        ),
      db
        .delete(todosTable)
        .where(
          inArray(
            todosTable.projectId,
            db
              .select({ id: projectsTable.id })
              .from(projectsTable)
              .where(eq(projectsTable.ownerId, ownerId)),
          ),
        ),
      db.delete(projectsTable).where(eq(projectsTable.ownerId, ownerId)),
    ] as const;

  /** Todo ids this owner may touch. Live todos only. */
  const ownedTodoIds = (todoId?: number) =>
    db
      .select({ id: todosTable.id })
      .from(todosTable)
      .where(
        and(
          inArray(todosTable.projectId, accessibleProjectIds()),
          isNull(todosTable.deletedAt),
          todoId === undefined ? undefined : eq(todosTable.id, todoId),
        ),
      );

  const attachments = {
    listByTodo: (todoId: number) =>
      db
        .select()
        .from(attachmentsTable)
        .where(inArray(attachmentsTable.todoId, ownedTodoIds(todoId)))
        .orderBy(asc(attachmentsTable.id)),

    create: (values: {
      todoId: number;
      key: string;
      filename: string;
      contentType: string;
      size: number;
    }) =>
      db
        .insert(attachmentsTable)
        .values({ ...values, createdAt: now() })
        .returning(),

    find: (id: number) =>
      db
        .select()
        .from(attachmentsTable)
        .where(and(eq(attachmentsTable.id, id), inArray(attachmentsTable.todoId, ownedTodoIds()))),

    remove: (id: number) =>
      db
        .delete(attachmentsTable)
        .where(and(eq(attachmentsTable.id, id), inArray(attachmentsTable.todoId, ownedTodoIds())))
        .returning(),
  };

  return {
    projects,
    todos,
    members,
    roles,
    directory,
    isAdmin,
    links,
    wouldCycle,
    assignees,
    comments,
    events,
    shares,
    attachments,
    purgeOwnedData,
    /**
     * Every R2 key this owner has. Read this before `purgeOwnedData` runs.
     *
     * The object store is not part of the database, so deleting rows leaves the
     * files behind forever. Collecting the keys first is the only way to know
     * what to remove.
     */
    ownedAttachmentKeys: () =>
      db
        .select({ key: attachmentsTable.key })
        .from(attachmentsTable)
        .where(inArray(attachmentsTable.todoId, allOwnedTodoIds())),
    /**
     * Everything this owner has, for the data export.
     *
     * Deliberately ignores `deletedAt`, unlike every list method here. A user
     * asking for their data should get what the service actually holds, and
     * "we still have it but decided not to show you" is the wrong answer to
     * that question. Each row carries its own `deletedAt` so the state is
     * visible rather than hidden.
     *
     * Unpaginated on purpose. An export that stops at fifty rows is not an
     * export; the size limit this creates is handled by writing to R2 rather
     * than by returning less.
     */
    exportable: {
      projects: () => db.select().from(projectsTable).where(eq(projectsTable.ownerId, ownerId)),
      todos: () => db.select().from(todosTable).where(inArray(todosTable.id, allOwnedTodoIds())),
      attachments: () =>
        db
          .select()
          .from(attachmentsTable)
          .where(inArray(attachmentsTable.todoId, allOwnedTodoIds())),
      comments: () =>
        db
          .select()
          .from(todoCommentsTable)
          .where(inArray(todoCommentsTable.todoId, allOwnedTodoIds())),
      events: () =>
        db.select().from(todoEventsTable).where(inArray(todoEventsTable.todoId, allOwnedTodoIds())),
    },
    /**
     * The only way to make more than one statement atomic on D1. Statements run
     * sequentially and non-concurrently; if any fails the whole sequence rolls
     * back. `db` itself is deliberately not exported so query construction
     * cannot scatter back out into the handlers.
     */
    batch: <U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(statements: T) =>
      db.batch(statements),
  };
}

export type Repo = ReturnType<typeof createRepo>;
