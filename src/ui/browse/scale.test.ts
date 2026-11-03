import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CARD_HEIGHT, CARD_WIDTH, computeScale } from './scale.js';

describe('computeScale', () => {
  it.each([
    [1024, 684, 2],
    [1100, 700, 2],
    [512, 342, 1],
    [1600, 342, 1],
    [400, 300, 400 / 512],
    [0, 0, 1],
    [-5, 100, 1],
    [Number.NaN, 100, 1],
  ])('%d × %d → %d', (w, h, expected) => {
    expect(computeScale(w, h)).toBeCloseTo(expected, 10);
  });

  it('PBT: the scaled card always fits and is integral at 1× and above', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        (w, h) => {
          const s = computeScale(w, h);
          expect(s).toBeGreaterThan(0);
          expect(CARD_WIDTH * s).toBeLessThanOrEqual(w + 1e-9);
          expect(CARD_HEIGHT * s).toBeLessThanOrEqual(h + 1e-9);
          if (s >= 1) expect(Number.isInteger(s)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
