import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clampRect, contains, HANDLES, handlePoints, hitHandle, hitTest, isClamped, MIN_SIZE, moveRect,
  nudgeRect, resizeRect, toLogicalDelta, type Handle,
} from './geometry.js';
import { button, field } from '../browse/testStacks.js';
import type { Rect } from '../../model/types.js';

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe('clampRect', () => {
  it('rounds to integers and enforces the minimum size', () => {
    expect(clampRect(R(10.4, 20.6, 1.2, 0))).toEqual(R(10, 21, MIN_SIZE, MIN_SIZE));
  });

  it('keeps at least MIN_SIZE px on the card at every edge', () => {
    expect(clampRect(R(-500, 10, 100, 20))).toEqual(R(MIN_SIZE - 100, 10, 100, 20));
    expect(clampRect(R(600, 10, 100, 20))).toEqual(R(512 - MIN_SIZE, 10, 100, 20));
    expect(clampRect(R(10, -500, 100, 20))).toEqual(R(10, MIN_SIZE - 20, 100, 20));
    expect(clampRect(R(10, 999, 100, 20))).toEqual(R(10, 342 - MIN_SIZE, 100, 20));
  });

  it('leaves valid rects untouched', () => {
    expect(clampRect(R(0, 0, 512, 342))).toEqual(R(0, 0, 512, 342));
    expect(isClamped(R(5, 5, 10, 10))).toBe(true);
    expect(isClamped(R(5, 5, 2, 10))).toBe(false);
  });
});

describe('move, nudge, resize', () => {
  const start = R(100, 100, 50, 30);

  it('toLogicalDelta rounds at any scale', () => {
    expect(toLogicalDelta(7, 2)).toBe(4);
    expect(toLogicalDelta(-3, 2)).toBe(-1);
    expect(toLogicalDelta(1, 2)).toBe(1);
    expect(toLogicalDelta(0.9, 2)).toBe(0);
    expect(Object.is(toLogicalDelta(-0.4, 1), 0)).toBe(true);
    expect(toLogicalDelta(3, 0.75)).toBe(4);
    expect(toLogicalDelta(5, 0)).toBe(5);
  });

  it('moveRect and nudgeRect translate and clamp', () => {
    expect(moveRect(start, 10, -5)).toEqual(R(110, 95, 50, 30));
    expect(nudgeRect(start, 0, -1000)).toEqual(R(100, MIN_SIZE - 30, 50, 30));
  });

  it.each<[Handle, number, number, Rect]>([
    ['nw', 10, 10, R(110, 110, 40, 20)],
    ['n', 10, 10, R(100, 110, 50, 20)],
    ['ne', 10, 10, R(100, 110, 60, 20)],
    ['e', 10, 10, R(100, 100, 60, 30)],
    ['se', 10, 10, R(100, 100, 60, 40)],
    ['s', 10, 10, R(100, 100, 50, 40)],
    ['sw', 10, 10, R(110, 100, 40, 40)],
    ['w', 10, 10, R(110, 100, 40, 30)],
  ])('%s handle by (%d, %d)', (handle, dx, dy, expected) => {
    expect(resizeRect(start, handle, dx, dy)).toEqual(expected);
  });

  it('a handle cannot cross the opposite edge', () => {
    expect(resizeRect(start, 'w', 1000, 0)).toEqual(R(146, 100, MIN_SIZE, 30));
    expect(resizeRect(start, 'e', -1000, 0)).toEqual(R(100, 100, MIN_SIZE, 30));
    expect(resizeRect(start, 'n', 0, 1000)).toEqual(R(100, 126, 50, MIN_SIZE));
    expect(resizeRect(start, 's', 0, -1000)).toEqual(R(100, 100, 50, MIN_SIZE));
  });
});

describe('handles and hit testing', () => {
  it('handlePoints sit on the corners and edge midpoints', () => {
    const p = handlePoints(R(10, 20, 31, 11));
    expect(p.nw).toEqual({ x: 10, y: 20 });
    expect(p.n).toEqual({ x: 25, y: 20 });
    expect(p.se).toEqual({ x: 41, y: 31 });
    expect(p.w).toEqual({ x: 10, y: 25 });
  });

  it('hitHandle uses 4×4 squares centred on the points', () => {
    const r = R(10, 20, 30, 10);
    expect(hitHandle(r, 10, 20)).toBe('nw');
    expect(hitHandle(r, 8, 18)).toBe('nw');
    expect(hitHandle(r, 12, 22)).toBeNull();
    expect(hitHandle(r, 40, 30)).toBe('se');
    expect(hitHandle(r, 25, 25)).toBeNull();
    expect(HANDLES.length).toBe(8);
  });

  it('hitTest: half-open bounds, topmost wins, hidden objects count', () => {
    const below = button('Below', { rect: R(0, 0, 100, 100) });
    const above = field('Above', { rect: R(50, 50, 100, 100), visible: false });
    const objects = [below, above];
    expect(hitTest(objects, 60, 60)).toBe(above);
    expect(hitTest(objects, 10, 10)).toBe(below);
    expect(hitTest(objects, 150, 60)).toBeNull();
    expect(contains(R(0, 0, 10, 10), 10, 5)).toBe(false);
    expect(contains(R(0, 0, 10, 10), 0, 0)).toBe(true);
  });
});

describe('PBT: geometry keeps rects integral and clamped', () => {
  const rect = fc.record({
    x: fc.integer({ min: -600, max: 600 }), y: fc.integer({ min: -600, max: 600 }),
    w: fc.integer({ min: 0, max: 700 }), h: fc.integer({ min: 0, max: 700 }),
  });
  const scale = fc.double({ min: 0.05, max: 8, noNaN: true });
  const delta = fc.double({ min: -2000, max: 2000, noNaN: true });
  const handle = fc.constantFrom(...HANDLES);

  it('move, resize and nudge always return clamped integer rects (200 runs)', () => {
    fc.assert(
      fc.property(rect, scale, delta, delta, handle, (r, s, cx, cy, hd) => {
        const dx = toLogicalDelta(cx, s);
        const dy = toLogicalDelta(cy, s);
        for (const out of [moveRect(r, dx, dy), resizeRect(r, hd, dx, dy), nudgeRect(r, Math.sign(dx), 0)]) {
          for (const v of [out.x, out.y, out.w, out.h]) expect(Number.isInteger(v)).toBe(true);
          expect(isClamped(out)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
