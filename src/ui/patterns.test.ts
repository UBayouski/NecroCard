import { describe, expect, it } from 'vitest';
import { readSource } from './browse/readSource.js';
import { BAYER_8, DITHER_DENSITIES, ditherCellCount, ditherTileSvg, ditherTileUrl } from './patterns.js';

describe('src/assets/patterns/*.svg', () => {
  const file = (p: number) => `../assets/patterns/dither-${String(p).replace('.', '-')}.svg`;

  it.each(DITHER_DENSITIES.map(p => [p]))('the %s %% tile is exactly what the generator produces', async p => {
    const svg = await readSource(file(p), import.meta.url);
    expect(svg.trim()).toBe(ditherTileSvg(p));
    expect((svg.match(/<rect /g) ?? []).length).toBe(ditherCellCount(p));
  });

  it('the 50 % tile is the classic one-pixel checkerboard browse.css already uses', async () => {
    const svg = await readSource(file(50), import.meta.url);
    const black = new Set([...svg.matchAll(/x="(\d)" y="(\d)"/g)].map(m => `${m[1]},${m[2]}`));
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(black.has(`${x},${y}`)).toBe((x + y) % 2 === 0);
  });
});

describe('BAYER_8', () => {
  it('is a permutation of 0..63', () => {
    expect(BAYER_8.length).toBe(64);
    expect([...BAYER_8].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it('has the standard first row', () => {
    expect(BAYER_8.slice(0, 8)).toEqual([0, 32, 8, 40, 2, 34, 10, 42]);
  });

  it('is frozen, so no importer can change the shared matrix', () => {
    expect(Object.isFrozen(BAYER_8)).toBe(true);
  });
});

describe('dither density tiles', () => {
  const cells = (svg: string) => svg.match(/<rect /g)?.length ?? 0;

  it.each([
    [12.5, 8], [25, 16], [37.5, 24], [50, 32], [62.5, 40], [75, 48], [87.5, 56],
  ])('%s %% has %i black pixels of 64', (percent, count) => {
    expect(ditherCellCount(percent)).toBe(count);
    expect(cells(ditherTileSvg(percent))).toBe(count);
  });

  it('covers exactly the seven classic densities, strictly increasing', () => {
    expect([...DITHER_DENSITIES]).toEqual([12.5, 25, 37.5, 50, 62.5, 75, 87.5]);
    const counts = DITHER_DENSITIES.map(ditherCellCount);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  it('each denser tile contains every black pixel of the sparser one (nested like the dissolve)', () => {
    const set = (p: number) => new Set(ditherTileSvg(p).match(/x="\d" y="\d"/g));
    for (let i = 1; i < DITHER_DENSITIES.length; i++) {
      const sparse = set(DITHER_DENSITIES[i - 1]);
      const dense = set(DITHER_DENSITIES[i]);
      for (const c of sparse) expect(dense.has(c)).toBe(true);
    }
  });

  it('tiles are 8 × 8, black only, hard-edged, and stay inside the tile', () => {
    const svg = ditherTileSvg(37.5);
    expect(svg).toContain('width="8" height="8"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="#000"');
    for (const [, x, y] of svg.matchAll(/x="(\d+)" y="(\d+)"/g)) {
      expect(Number(x)).toBeLessThan(8);
      expect(Number(y)).toBeLessThan(8);
    }
  });

  it('URLs are inline SVG data URLs (no network)', () => {
    const url = ditherTileUrl(50);
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('<svg');
  });

  it('clamps out-of-range densities', () => {
    expect(ditherCellCount(-5)).toBe(0);
    expect(ditherCellCount(150)).toBe(64);
  });
});
