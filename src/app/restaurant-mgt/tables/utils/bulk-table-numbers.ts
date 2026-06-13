/**
 * Pure number-planning for the "Add multiple tables" flow.
 *
 * Given a starting table number, a count, and the set of numbers that already
 * exist, partition the contiguous range `start … start + count - 1` into the
 * numbers we should create vs. the numbers we should skip (because a table with
 * that number already exists). Framework-free so it can be unit-tested directly.
 */
export interface BulkNumberPlan {
  /** Numbers in the range that are free to create, in ascending order. */
  toCreate: number[];
  /** Numbers in the range that already exist and will be skipped. */
  skipped: number[];
}

export function computeBulkTableNumbers(
  start: number,
  count: number,
  existing: Iterable<number>,
): BulkNumberPlan {
  // Defensive: a malformed range yields an empty plan. The modal also guards
  // (count 1–100, start ≥ 1), but keeping this total means callers never crash.
  if (!Number.isInteger(start) || !Number.isInteger(count) || count < 1) {
    return { toCreate: [], skipped: [] };
  }

  const taken = new Set(existing);
  const toCreate: number[] = [];
  const skipped: number[] = [];

  for (let n = start; n < start + count; n++) {
    (taken.has(n) ? skipped : toCreate).push(n);
  }

  return { toCreate, skipped };
}
