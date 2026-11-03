import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resolveNavigation } from './navigation.js';
import { NecroTalkError } from './errors.js';
import type { GoTarget } from './ast.js';

const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
const COUNT = NAMES.length;

describe('resolveNavigation — basic', () => {
  it('next returns currentIndex + 1', () => {
    expect(resolveNavigation({ type: 'next' }, 0, COUNT, NAMES)).toBe(1);
    expect(resolveNavigation({ type: 'next' }, 2, COUNT, NAMES)).toBe(3);
  });

  it('next on last card wraps to 0', () => {
    expect(resolveNavigation({ type: 'next' }, 4, COUNT, NAMES)).toBe(0);
  });

  it('prev returns currentIndex - 1', () => {
    expect(resolveNavigation({ type: 'prev' }, 3, COUNT, NAMES)).toBe(2);
  });

  it('prev on first card wraps to cardCount - 1', () => {
    expect(resolveNavigation({ type: 'prev' }, 0, COUNT, NAMES)).toBe(4);
  });

  it('first always returns 0', () => {
    expect(resolveNavigation({ type: 'first' }, 3, COUNT, NAMES)).toBe(0);
  });

  it('last always returns cardCount - 1', () => {
    expect(resolveNavigation({ type: 'last' }, 0, COUNT, NAMES)).toBe(4);
  });
});

describe('resolveNavigation — numeric card index (1-based)', () => {
  it('card 1 → index 0', () => {
    expect(resolveNavigation({ type: 'card', value: 1 }, 0, COUNT, NAMES)).toBe(0);
  });

  it('card 5 → index 4', () => {
    expect(resolveNavigation({ type: 'card', value: 5 }, 0, COUNT, NAMES)).toBe(4);
  });

  it('card 0 throws NecroTalkError', () => {
    expect(() => resolveNavigation({ type: 'card', value: 0 }, 0, COUNT, NAMES, 3))
      .toThrow(NecroTalkError);
  });

  it('card 6 (> COUNT) throws NecroTalkError', () => {
    expect(() => resolveNavigation({ type: 'card', value: 6 }, 0, COUNT, NAMES, 7))
      .toThrow(NecroTalkError);
  });

  it('error message contains line number', () => {
    try {
      resolveNavigation({ type: 'card', value: 0 }, 0, COUNT, NAMES, 5);
    } catch (e) {
      expect((e as NecroTalkError).line).toBe(5);
      expect((e as NecroTalkError).message).toContain('Line 5');
    }
  });
});

describe('resolveNavigation — named card', () => {
  it('finds card by name case-insensitively', () => {
    expect(resolveNavigation({ type: 'card', value: 'gamma' }, 0, COUNT, NAMES)).toBe(2);
    expect(resolveNavigation({ type: 'card', value: 'ALPHA' }, 0, COUNT, NAMES)).toBe(0);
    expect(resolveNavigation({ type: 'card', value: 'Epsilon' }, 0, COUNT, NAMES)).toBe(4);
  });

  it('throws NecroTalkError for unknown name', () => {
    expect(() => resolveNavigation({ type: 'card', value: 'Missing' }, 0, COUNT, NAMES, 3))
      .toThrow(NecroTalkError);
  });

  it('error message mentions the missing card name', () => {
    try {
      resolveNavigation({ type: 'card', value: 'Ghost' }, 0, COUNT, NAMES, 2);
    } catch (e) {
      expect((e as NecroTalkError).message).toContain('Ghost');
    }
  });
});

describe('PBT — navigation range invariant', () => {
  // Only use valid targets (next/prev/first/last and 1-based card numbers 1..COUNT)
  const validTargetArb: fc.Arbitrary<GoTarget> = fc.oneof(
    fc.constantFrom<GoTarget>(
      { type: 'next' }, { type: 'prev' }, { type: 'first' }, { type: 'last' }
    ),
    fc.integer({ min: 1, max: COUNT }).map(n => ({ type: 'card' as const, value: n })),
    fc.constantFrom(...NAMES).map(name => ({ type: 'card' as const, value: name })),
  );

  it('resolveNavigation always returns a valid index (200 runs)', () => {
    fc.assert(
      fc.property(
        fc.array(validTargetArb, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: COUNT - 1 }),
        (targets, startIndex) => {
          let idx = startIndex;
          for (const target of targets) {
            idx = resolveNavigation(target, idx, COUNT, NAMES);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(COUNT);
          }
        }
      ),
      { numRuns: 200 },
    );
  });
});
