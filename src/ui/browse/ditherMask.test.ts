import { describe, expect, it } from 'vitest';
import { ditherMaskSvg, ditherMaskUrl, maskCoverage } from './ditherMask.js';

describe('dither masks', () => {
  it('coverage goes 0 → 64 and never decreases', () => {
    expect(maskCoverage(0, 11)).toBe(0);
    expect(maskCoverage(11, 11)).toBe(64);
    for (let k = 1; k <= 11; k++) {
      expect(maskCoverage(k, 11)).toBeGreaterThanOrEqual(maskCoverage(k - 1, 11));
    }
  });

  it('each frame reveals exactly `coverage` cells, and every earlier cell stays revealed', () => {
    let previous = new Set<string>();
    for (let k = 0; k <= 11; k++) {
      const cells = new Set(ditherMaskSvg(k, 11).match(/x="\d" y="\d"/g) ?? []);
      expect(cells.size).toBe(maskCoverage(k, 11));
      for (const c of previous) expect(cells.has(c)).toBe(true);
      previous = cells;
    }
  });

  it('URLs are inline SVG data URLs (no network, no canvas)', () => {
    const url = ditherMaskUrl(5, 11);
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('shape-rendering="crispEdges"');
  });
});
