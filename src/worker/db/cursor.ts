/**
 * Keyset pagination cursors.
 *
 * Offset pagination is the obvious alternative and the wrong one here. `LIMIT
 * ? OFFSET ?` makes SQLite walk and discard every skipped row, and D1 bills
 * rows *scanned* — so page 100 costs a hundred times page 1 for the same
 * output. Keyset pagination seeks straight to the position instead.
 *
 * The cursor carries the sort value and the row id, because the sort value
 * alone is not unique: two todos can share a due date, and a cursor that only
 * remembered the date would either repeat them or skip them.
 *
 * Base64 rather than a readable string, to discourage callers from picking it
 * apart and depending on a shape we intend to change.
 */
export type Cursor = { value: string | number | null; id: number };

export function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify([cursor.value, cursor.id]));
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(atob(raw));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;

    const [value, id] = parsed as [unknown, unknown];
    if (typeof id !== "number" || !Number.isInteger(id)) return null;
    if (value !== null && typeof value !== "string" && typeof value !== "number") return null;

    return { value, id };
  } catch {
    // A hand-edited or stale cursor should start from the beginning rather
    // than fail the request — it is a position, not an instruction.
    return null;
  }
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Splits a fetched page into the rows to return and the cursor to continue at.
 *
 * Callers fetch `limit + 1` rows: the extra row is how we know whether more
 * exist without a second count query, which on D1 would double the rows read.
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => Cursor,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };

  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(toCursor(items[items.length - 1]!)) };
}
