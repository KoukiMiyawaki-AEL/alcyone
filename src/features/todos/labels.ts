/**
 * Whether two label sets are the same, ignoring order.
 *
 * Order is not part of what a set means, and the two sides come from different
 * places — one from the server, one from a picker — so comparing them as arrays
 * would report a change every time.
 */
export function sameLabels(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((id) => left.has(id));
}
