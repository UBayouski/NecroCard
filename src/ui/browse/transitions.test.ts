// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  frameAt, frameStyle, runTransition, TRANSITION_DURATION_MS, TRANSITION_FRAMES,
  type TransitionClock, type VisualEffect,
} from './transitions.js';
import { readSource } from './readSource.js';

const EFFECTS: VisualEffect[] = ['dissolve', 'wipe left', 'wipe right', 'scroll up'];

/** A manual clock: each requested frame runs when `step(ms)` is called. */
function manualClock(reduced = false) {
  let t = 0;
  let queue: (() => void)[] = [];
  const clock: TransitionClock = {
    now: () => t,
    requestFrame: cb => { queue.push(cb); },
    reducedMotion: () => reduced,
  };
  const step = (ms: number) => {
    t += ms;
    const q = queue;
    queue = [];
    q.forEach(cb => cb());
  };
  return { clock, step, pending: () => queue.length };
}

function layers() {
  const surface = document.createElement('div');
  const oldLayer = document.createElement('div');
  oldLayer.className = 'card-layer';
  surface.append(oldLayer);
  const newLayer = document.createElement('div');
  newLayer.className = 'card-layer';
  return { surface, oldLayer, newLayer };
}

describe('frameStyle', () => {
  it('constants match retro-ui', () => {
    expect(TRANSITION_DURATION_MS).toBe(333);
    expect(TRANSITION_FRAMES).toBe(11);
  });

  it('wipe left reveals from the right edge, wipe right from the left edge', () => {
    expect(frameStyle('wipe left', 0).newCard['clip-path']).toBe('inset(0px 0px 0px 512px)');
    expect(frameStyle('wipe left', 11).newCard['clip-path']).toBe('inset(0px 0px 0px 0px)');
    expect(frameStyle('wipe right', 0).newCard['clip-path']).toBe('inset(0px 512px 0px 0px)');
    expect(frameStyle('wipe right', 4).newCard['clip-path']).toBe('inset(0px 326px 0px 0px)');
  });

  it('scroll up moves the old card up while the new card follows', () => {
    const mid = frameStyle('scroll up', 5);
    expect(mid.newCard.transform).toBe('translateY(187px)');
    expect(mid.oldCard.transform).toBe('translateY(-155px)');
    expect(frameStyle('scroll up', 11).newCard.transform).toBe('translateY(0px)');
    expect(frameStyle('scroll up', 11).oldCard.transform).toBe('translateY(-342px)');
  });

  it('dissolve uses a pixel-sized repeating dither mask', () => {
    const s = frameStyle('dissolve', 3).newCard;
    expect(s['mask-image']).toContain('data:image/svg+xml');
    expect(s['mask-size']).toBe('8px 8px');
    expect(s['-webkit-mask-image']).toBe(s['mask-image']);
  });

  it('PBT: frame 0 is all old, the last frame all new, coverage never decreases, whole pixels only', () => {
    fc.assert(
      fc.property(fc.constantFrom(...EFFECTS), fc.integer({ min: 1, max: TRANSITION_FRAMES }), (effect, k) => {
        expect(frameStyle(effect, 0).coverage).toBe(0);
        expect(frameStyle(effect, TRANSITION_FRAMES).coverage).toBe(1);
        expect(frameStyle(effect, k).coverage).toBeGreaterThanOrEqual(frameStyle(effect, k - 1).coverage);
        const all = { ...frameStyle(effect, k).oldCard, ...frameStyle(effect, k).newCard };
        for (const [prop, v] of Object.entries(all)) {
          if (prop.includes('mask-image')) continue;
          for (const n of v.match(/-?\d+(\.\d+)?px/g) ?? []) expect(Number.isInteger(parseFloat(n))).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('frameAt steps discretely and lands on the last frame at 333 ms', () => {
    expect(frameAt(0)).toBe(0);
    expect(frameAt(31)).toBe(1);
    expect(frameAt(332)).toBe(10);
    expect(frameAt(333)).toBe(11);
    expect(frameAt(10_000)).toBe(11);
  });
});

describe('runTransition', () => {
  it.each(EFFECTS)('%s: steps frames, then removes the old layer and clears styles', async effect => {
    const { surface, oldLayer, newLayer } = layers();
    const { clock, step, pending } = manualClock();
    let done = false;
    const p = runTransition(effect, oldLayer, newLayer, clock).then(() => { done = true; });
    expect(oldLayer.inert).toBe(true);
    expect(surface.children[1]).toBe(newLayer);
    expect(newLayer.classList.contains('card-layer--incoming')).toBe(true);
    let frames = 0;
    while (pending() > 0 && frames < 100) { step(16); frames++; }
    await p;
    expect(done).toBe(true);
    expect(frames).toBeGreaterThanOrEqual(TRANSITION_FRAMES);
    expect(oldLayer.isConnected).toBe(false);
    expect(surface.children.length).toBe(1);
    expect(newLayer.getAttribute('style') ?? '').toBe('');
    expect(newLayer.classList.contains('card-layer--incoming')).toBe(false);
  });

  it('reduced motion swaps in one step', async () => {
    const { surface, oldLayer, newLayer } = layers();
    const { clock, pending } = manualClock(true);
    await runTransition('dissolve', oldLayer, newLayer, clock);
    expect(pending()).toBe(0);
    expect(Array.from(surface.children)).toEqual([newLayer]);
  });

  it('browse.css declares no CSS transitions or animations', async () => {
    const css = await readSource('./browse.css', import.meta.url);
    expect(css).not.toMatch(/(^|[\s;{])(transition|animation)\s*:/);
  });
});
