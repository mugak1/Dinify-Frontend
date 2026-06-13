import { computeBulkTableNumbers } from './bulk-table-numbers';

describe('computeBulkTableNumbers', () => {
  it('creates the whole contiguous range when nothing exists yet', () => {
    const { toCreate, skipped } = computeBulkTableNumbers(1, 5, []);
    expect(toCreate).toEqual([1, 2, 3, 4, 5]);
    expect(skipped).toEqual([]);
  });

  it('skips numbers that already exist and keeps ascending order', () => {
    const { toCreate, skipped } = computeBulkTableNumbers(1, 5, [2, 4]);
    expect(toCreate).toEqual([1, 3, 5]);
    expect(skipped).toEqual([2, 4]);
  });

  it('accepts a Set as the existing source', () => {
    const { toCreate, skipped } = computeBulkTableNumbers(5, 4, new Set([6, 7]));
    expect(toCreate).toEqual([5, 8]);
    expect(skipped).toEqual([6, 7]);
  });

  it('returns an empty toCreate when every number in the range is taken', () => {
    const { toCreate, skipped } = computeBulkTableNumbers(10, 3, [10, 11, 12, 99]);
    expect(toCreate).toEqual([]);
    expect(skipped).toEqual([10, 11, 12]);
  });

  it('handles a count of 1', () => {
    expect(computeBulkTableNumbers(7, 1, [])).toEqual({ toCreate: [7], skipped: [] });
    expect(computeBulkTableNumbers(7, 1, [7])).toEqual({ toCreate: [], skipped: [7] });
  });

  it('starts cleanly above all existing numbers', () => {
    const { toCreate, skipped } = computeBulkTableNumbers(6, 3, [1, 2, 5]);
    expect(toCreate).toEqual([6, 7, 8]);
    expect(skipped).toEqual([]);
  });

  it('does not auto-fill gaps below the start — the range is anchored at start', () => {
    // existing 1,2,5 with a gap at 3,4; starting at 6 leaves the gap untouched.
    const { toCreate } = computeBulkTableNumbers(6, 2, [1, 2, 5]);
    expect(toCreate).toEqual([6, 7]);
    expect(toCreate).not.toContain(3);
    expect(toCreate).not.toContain(4);
  });

  it('returns an empty plan for non-integer or non-positive input', () => {
    expect(computeBulkTableNumbers(1.5, 3, [])).toEqual({ toCreate: [], skipped: [] });
    expect(computeBulkTableNumbers(1, 0, [])).toEqual({ toCreate: [], skipped: [] });
    expect(computeBulkTableNumbers(1, -2, [])).toEqual({ toCreate: [], skipped: [] });
    expect(computeBulkTableNumbers(1, 2.5, [])).toEqual({ toCreate: [], skipped: [] });
  });
});
