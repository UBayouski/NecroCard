// The shared ordered-dither source (retro-skin REQ-2): the 8 × 8 Bayer matrix, and the classic seven density tiles
// built from it. The dissolve transition (browse/ditherMask.ts), the image dither (edit/dither.ts) and any 1-bit
// fill share this one matrix, so a 50 % fill and a half-done dissolve are the same pattern. Pure data, no imports.

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

/** The classic Mac dither densities, in percent of black. */
export const DITHER_DENSITIES = [12.5, 25, 37.5, 50, 62.5, 75, 87.5] as const;
export type DitherDensity = (typeof DITHER_DENSITIES)[number];

/** Black cells in the 64-cell tile for a density: 12.5 % → 8, 50 % → 32, 87.5 % → 56. */
export function ditherCellCount(percent: number): number {
  return Math.min(64, Math.max(0, Math.round((percent / 100) * 64)));
}

/** An 8 × 8 SVG tile, black cells where the Bayer threshold is below the density. Hard 1 × 1 pixels. */
export function ditherTileSvg(percent: number): string {
  const count = ditherCellCount(percent);
  const rects: string[] = [];
  BAYER_8.forEach((threshold, i) => {
    if (threshold < count) rects.push(`<rect x="${i % 8}" y="${Math.floor(i / 8)}" width="1" height="1"/>`);
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges" fill="#000">'
    + rects.join('') + '</svg>';
}

/** A CSS `url("data:image/svg+xml,…")` for a density tile; use with `background-size: 8px 8px`. */
export function ditherTileUrl(percent: number): string {
  return `url("data:image/svg+xml,${encodeURIComponent(ditherTileSvg(percent))}")`;
}
