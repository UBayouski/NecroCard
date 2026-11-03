import { CARD_HEIGHT, CARD_WIDTH } from './scale.js';
import { ditherMaskUrl, maskCoverage } from './ditherMask.js';

export type VisualEffect = 'dissolve' | 'wipe left' | 'wipe right' | 'scroll up';

/** Engine constants (retro-ui: not CSS variables). */
export const TRANSITION_DURATION_MS = 333;
export const TRANSITION_FRAMES = 11;

/** Inline CSS (kebab-case property → value) for one frame of the old and new card layers. */
export interface FrameStyle {
  oldCard: Record<string, string>;
  newCard: Record<string, string>;
  /** Fraction of the card area showing the new card, 0..1 (for tests and invariants). */
  coverage: number;
}

// Masks for every dissolve frame, computed once.
const MASKS = Array.from({ length: TRANSITION_FRAMES + 1 }, (_, k) => ditherMaskUrl(k, TRANSITION_FRAMES));

/** Pure: the styles for frame `k` (0..TRANSITION_FRAMES). Whole logical pixels only. */
export function frameStyle(effect: VisualEffect, k: number): FrameStyle {
  const frame = Math.min(TRANSITION_FRAMES, Math.max(0, Math.round(k)));
  const t = frame / TRANSITION_FRAMES;
  switch (effect) {
    case 'dissolve': {
      const mask = MASKS[frame];
      return {
        oldCard: {},
        newCard: {
          'mask-image': mask, '-webkit-mask-image': mask,
          'mask-size': '8px 8px', '-webkit-mask-size': '8px 8px',
          'mask-repeat': 'repeat', '-webkit-mask-repeat': 'repeat',
        },
        coverage: maskCoverage(frame, TRANSITION_FRAMES) / 64,
      };
    }
    case 'wipe left': {
      const hidden = Math.round(CARD_WIDTH * (1 - t));
      return { oldCard: {}, newCard: { 'clip-path': `inset(0px 0px 0px ${hidden}px)` }, coverage: (CARD_WIDTH - hidden) / CARD_WIDTH };
    }
    case 'wipe right': {
      const hidden = Math.round(CARD_WIDTH * (1 - t));
      return { oldCard: {}, newCard: { 'clip-path': `inset(0px ${hidden}px 0px 0px)` }, coverage: (CARD_WIDTH - hidden) / CARD_WIDTH };
    }
    case 'scroll up': {
      const offset = Math.round(CARD_HEIGHT * (1 - t));
      return {
        oldCard: { transform: `translateY(${offset - CARD_HEIGHT}px)` },
        newCard: { transform: `translateY(${offset}px)` },
        coverage: (CARD_HEIGHT - offset) / CARD_HEIGHT,
      };
    }
  }
}

/** Frame index for an elapsed time: discrete steps of 333 / 11 ms; frame 11 lands at 333 ms. */
export function frameAt(elapsedMs: number): number {
  return Math.min(TRANSITION_FRAMES, Math.max(0, Math.floor(elapsedMs / (TRANSITION_DURATION_MS / TRANSITION_FRAMES))));
}

const STYLE_KEYS = [
  'mask-image', '-webkit-mask-image', 'mask-size', '-webkit-mask-size', 'mask-repeat',
  '-webkit-mask-repeat', 'clip-path', 'transform',
];

function apply(el: HTMLElement, style: Record<string, string>): void {
  for (const [k, v] of Object.entries(style)) el.style.setProperty(k, v);
}

function clear(el: HTMLElement): void {
  for (const k of STYLE_KEYS) el.style.removeProperty(k);
}

export interface TransitionClock {
  now(): number;
  requestFrame(cb: () => void): void;
  reducedMotion(): boolean;
}

export const browserClock: TransitionClock = {
  now: () => performance.now(),
  requestFrame: cb => { requestAnimationFrame(() => cb()); },
  reducedMotion: () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
};

/**
 * Run a stepped transition from `oldLayer` (already in the DOM) to `newLayer`.
 * The new layer is inserted above the old, the old is made inert, frames advance on
 * animation frames by elapsed time, and at the end the old layer is removed and all
 * transition styles are cleared. Never uses CSS transitions or reads pixels back.
 */
export function runTransition(
  effect: VisualEffect, oldLayer: HTMLElement, newLayer: HTMLElement, clock: TransitionClock = browserClock,
): Promise<void> {
  oldLayer.inert = true;
  newLayer.classList.add('card-layer--incoming');
  oldLayer.after(newLayer);

  const finish = () => {
    oldLayer.remove();
    clear(oldLayer);
    clear(newLayer);
    newLayer.classList.remove('card-layer--incoming');
  };

  if (clock.reducedMotion()) {
    finish();
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const start = clock.now();
    let shown = -1;
    const show = (k: number) => {
      if (k === shown) return;
      shown = k;
      const s = frameStyle(effect, k);
      apply(oldLayer, s.oldCard);
      apply(newLayer, s.newCard);
    };
    show(0);
    const tick = () => {
      const k = frameAt(clock.now() - start);
      show(k);
      if (k >= TRANSITION_FRAMES) {
        finish();
        resolve();
      } else {
        clock.requestFrame(tick);
      }
    };
    clock.requestFrame(tick);
  });
}
