import { bucketAxisLabel } from './timeframe-labels';

// `bucketAxisLabel` had no spec before LADDER-WEEK-00. This covers the new `week` arm and the
// `day` arm it has to stay distinguishable from; the other arms remain as they were.
//
// The dashboard series key is an ISO DATETIME (`at`, produced by `dayAtIso`'s `toISOString()`),
// not Reports' `yyyy-MM-dd` `period` — the two formats are deliberately NOT unified. Local
// midnight is used below for the same reason the mock does: `new Date(at)` re-localises, so a
// local-midnight input round-trips in whatever zone the suite runs in.
describe('bucketAxisLabel', () => {
  /** Local midnight for a `yyyy-MM-dd` day, matching `dayAtIso`'s output. */
  const at = (day: string): string => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toISOString();
  };

  const MONDAY = '2026-07-20';

  it('prefixes a week tick with w/c so it cannot be read as a single day', () => {
    // Both buckets render the same underlying date, so the prefix is the ONLY thing separating
    // "Monday the 20th took X" from "the week of the 20th took X". On the dashboard this string
    // is also the tooltip title, which is what makes the distinction matter rather than decorate.
    expect(bucketAxisLabel(at(MONDAY), 'week')).toBe('w/c Jul 20');
    expect(bucketAxisLabel(at(MONDAY), 'day')).toBe('Jul 20');
    expect(bucketAxisLabel(at(MONDAY), 'week')).not.toBe(bucketAxisLabel(at(MONDAY), 'day'));
  });

  it('is a PER-POINT tick, not a bucket noun', () => {
    // The cards call this once per series point, so a bare "Weeks" here would label every tick
    // and every tooltip identically. The bucket noun lives on the Sales breakdown column head.
    const ticks = ['2026-07-06', '2026-07-13', MONDAY].map((d) => bucketAxisLabel(at(d), 'week'));
    expect(ticks).toEqual(['w/c Jul 6', 'w/c Jul 13', 'w/c Jul 20']);
    expect(new Set(ticks).size).toBe(3);
  });

  it('leaves the pre-existing arms alone', () => {
    expect(bucketAxisLabel(at('2026-07-01'), 'month')).toBe('Jul 26');
    expect(bucketAxisLabel(at('2026-01-01'), 'year')).toBe('2026');
  });

  it('falls through to the raw string for an unparseable `at`', () => {
    expect(bucketAxisLabel('not-a-date', 'week')).toBe('not-a-date');
  });
});
