import { HOUR_OF_DAY_SHAPE, distributeByHour } from './hour-of-day';

describe('shared hour-of-day curve', () => {
  it('HOUR_OF_DAY_SHAPE has 24 weights', () => {
    expect(HOUR_OF_DAY_SHAPE.length).toBe(24);
  });

  describe('distributeByHour', () => {
    it('returns 24 non-negative integers summing EXACTLY to the total', () => {
      for (const total of [0, 1, 7, 100, 999, 1_234_567]) {
        const out = distributeByHour(total);
        expect(out.length).toBe(24);
        out.forEach((v) => {
          expect(Number.isInteger(v)).toBeTrue();
          expect(v).toBeGreaterThanOrEqual(0);
        });
        expect(out.reduce((a, v) => a + v, 0)).toBe(total);
      }
    });

    it('weights the dinner peak above the overnight lull', () => {
      const out = distributeByHour(100_000);
      const overnight = out.slice(0, 6).reduce((a, v) => a + v, 0);
      const dinner = out.slice(19, 22).reduce((a, v) => a + v, 0);
      expect(dinner).toBeGreaterThan(overnight);
    });

    it('returns 24 zeros for a non-positive total', () => {
      expect(distributeByHour(0)).toEqual(new Array(24).fill(0));
    });
  });
});
