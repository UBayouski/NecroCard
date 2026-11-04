import { BAYER_8 } from '../patterns.js';

/** Number of the 64 tile cells revealed at `frame` of `frames` (0 at frame 0, 64 at the end). */
export function maskCoverage(frame: number, frames: number): number {
  const f = Math.min(frames, Math.max(0, frame));
  return Math.round((64 * f) / frames);
}

/**
 * An 8 × 8 SVG mask tile for one dissolve frame: opaque 1 × 1 cells reveal the new card.
 * Generated from strings (no canvas, no pixel read-back from the card DOM).
 */
export function ditherMaskSvg(frame: number, frames: number): string {
  const coverage = maskCoverage(frame, frames);
  const rects: string[] = [];
  BAYER_8.forEach((threshold, i) => {
    if (threshold < coverage) rects.push(`<rect x="${i % 8}" y="${Math.floor(i / 8)}" width="1" height="1"/>`);
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges" fill="#fff">'
    + rects.join('') + '</svg>';
}

export function ditherMaskUrl(frame: number, frames: number): string {
  return `url("data:image/svg+xml,${encodeURIComponent(ditherMaskSvg(frame, frames))}")`;
}
