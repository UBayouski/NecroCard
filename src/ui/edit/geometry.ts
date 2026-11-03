import type { CardObject, Rect } from '../../model/types.js';
import { CARD_HEIGHT, CARD_WIDTH } from '../browse/scale.js';

/** Smallest width/height, and how much of an object must stay on the card, in logical pixels. */
export const MIN_SIZE = 4;

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Side length of a selection handle (retro-ui: 4 × 4 px). */
export const HANDLE_SIZE = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Normalise any rect to the edit-mode rules (REQ-3.4): integers, min size, partly on the card. */
export function clampRect(r: Rect): Rect {
  const w = Math.max(MIN_SIZE, Math.round(r.w));
  const h = Math.max(MIN_SIZE, Math.round(r.h));
  const x = clamp(Math.round(r.x), MIN_SIZE - w, CARD_WIDTH - MIN_SIZE);
  const y = clamp(Math.round(r.y), MIN_SIZE - h, CARD_HEIGHT - MIN_SIZE);
  return { x, y, w, h };
}

/** A client-pixel delta in logical pixels at the current scale, always a whole number. */
export function toLogicalDelta(clientDelta: number, scale: number): number {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  const d = Math.round(clientDelta / s);
  return d === 0 ? 0 : d; // avoid -0
}

export function moveRect(start: Rect, dx: number, dy: number): Rect {
  return clampRect({ ...start, x: start.x + Math.round(dx), y: start.y + Math.round(dy) });
}

export function nudgeRect(r: Rect, dx: number, dy: number): Rect {
  return moveRect(r, dx, dy);
}

/**
 * Resize by dragging a handle. Only the dragged edges move; the opposite edge stays fixed and
 * cannot be crossed (width/height never drop below MIN_SIZE).
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number): Rect {
  const ddx = Math.round(dx);
  const ddy = Math.round(dy);
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  if (handle.includes('w')) {
    x = Math.min(start.x + ddx, right - MIN_SIZE);
    w = right - x;
  } else if (handle.includes('e')) {
    w = Math.max(MIN_SIZE, start.w + ddx);
  }
  if (handle.includes('n')) {
    y = Math.min(start.y + ddy, bottom - MIN_SIZE);
    h = bottom - y;
  } else if (handle.includes('s')) {
    h = Math.max(MIN_SIZE, start.h + ddy);
  }
  return clampRect({ x, y, w, h });
}

/** Centre points of the eight handles: corners and edge midpoints (midpoints rounded down). */
export function handlePoints(r: Rect): Record<Handle, { x: number; y: number }> {
  const cx = r.x + Math.floor(r.w / 2);
  const cy = r.y + Math.floor(r.h / 2);
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  return {
    nw: { x: r.x, y: r.y }, n: { x: cx, y: r.y }, ne: { x: right, y: r.y }, e: { x: right, y: cy },
    se: { x: right, y: bottom }, s: { x: cx, y: bottom }, sw: { x: r.x, y: bottom }, w: { x: r.x, y: cy },
  };
}

/** The handle under a logical point, if any (4 × 4 squares centred on the handle points). */
export function hitHandle(r: Rect, x: number, y: number): Handle | null {
  const half = HANDLE_SIZE / 2;
  const points = handlePoints(r);
  for (const handle of HANDLES) {
    const p = points[handle];
    if (x >= p.x - half && x < p.x + half && y >= p.y - half && y < p.y + half) return handle;
  }
  return null;
}

/** True when the point lies in the half-open rect [x, x + w) × [y, y + h). */
export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** The topmost object (last in array order) containing the point; hidden objects count. */
export function hitTest(objects: readonly CardObject[], x: number, y: number): CardObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    if (contains(objects[i].rect, x, y)) return objects[i];
  }
  return null;
}

/** True when a rect satisfies every clampRect rule (used by tests and DEV assertions). */
export function isClamped(r: Rect): boolean {
  const c = clampRect(r);
  return c.x === r.x && c.y === r.y && c.w === r.w && c.h === r.h;
}
