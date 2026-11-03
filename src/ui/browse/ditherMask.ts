/** Build the n×n ordered-dither (Bayer) threshold matrix, row-major, values 0..n²-1. */
function bayer(n: number): number[][] {
  if (n === 1) return [[0]];
  const half = bayer(n / 2);
  const size = half.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = 4 * half[y][x];
      out[y][x] = v;
      out[y][x + size] = v + 2;
      out[y + size][x] = v + 3;
      out[y + size][x + size] = v + 1;
    }
  }
  return out;
}

/** Standard 8 × 8 Bayer thresholds (0..63), row-major. */
export const BAYER_8: readonly number[] = Object.freeze(bayer(8).flat());

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
