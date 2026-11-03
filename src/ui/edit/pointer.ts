import type { Rect } from '../../model/types.js';
import { moveRect, resizeRect, toLogicalDelta, type Handle } from './geometry.js';

export interface ClientPoint { clientX: number; clientY: number }

/** A client position in logical card pixels (not rounded; used for hit testing). */
export function clientToLogical(
  e: ClientPoint, surfaceRect: { left: number; top: number }, scale: number,
): { x: number; y: number } {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  return { x: (e.clientX - surfaceRect.left) / s, y: (e.clientY - surfaceRect.top) / s };
}

export type Drag =
  | { kind: 'move'; id: string; start: Rect; startClient: { x: number; y: number } }
  | { kind: 'resize'; id: string; handle: Handle; start: Rect; startClient: { x: number; y: number } };

/**
 * The rect a drag would produce at this pointer position. Deltas are measured from the drag
 * start and rounded to whole logical pixels (REQ-3.1), so the result is always integral.
 */
export function dragRect(d: Drag, clientX: number, clientY: number, scale: number): Rect {
  const dx = toLogicalDelta(clientX - d.startClient.x, scale);
  const dy = toLogicalDelta(clientY - d.startClient.y, scale);
  return d.kind === 'move' ? moveRect(d.start, dx, dy) : resizeRect(d.start, d.handle, dx, dy);
}

/** True when the drag has not moved the rect at all (a plain click). */
export function isNoop(start: Rect, r: Rect): boolean {
  return start.x === r.x && start.y === r.y && start.w === r.w && start.h === r.h;
}
