import { describe, expect, it } from 'vitest';
import { ditherRgba, fitWithin, IMAGE_FIT } from './dither.js';
import { MIN_SIZE } from './geometry.js';

function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, g, b, a], i * 4);
  return px;
}

const count = (bits: Uint8Array) => bits.reduce((n, b) => n + b, 0);

describe('ditherRgba', () => {
  it('black stays black, white stays white', () => {
    expect(count(ditherRgba(solid(16, 16, 0, 0, 0), 16, 16))).toBe(256);
    expect(count(ditherRgba(solid(16, 16, 255, 255, 255), 16, 16))).toBe(0);
  });

  it('50% grey is exactly half black in every 8 × 8 tile', () => {
    const bits = ditherRgba(solid(16, 16, 128, 128, 128), 16, 16);
    expect(count(bits)).toBe(128);
    // Bayer: cell (0,0) has threshold 0 (white at mid grey), cell (1,0) has threshold 32 (black).
    expect(bits[0]).toBe(0);
    expect(bits[1]).toBe(1);
  });

  it('transparent pixels are white whatever their colour', () => {
    expect(count(ditherRgba(solid(8, 8, 0, 0, 0, 127), 8, 8))).toBe(0);
    expect(count(ditherRgba(solid(8, 8, 0, 0, 0, 128), 8, 8))).toBe(64);
  });

  it('uses luminance, so pure green is darker than mid grey would suggest only by weight', () => {
    // 0.587 × 255 ≈ 150 → fewer than half the cells are black.
    const n = count(ditherRgba(solid(8, 8, 0, 255, 0), 8, 8));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(32);
  });

  it('rejects short pixel buffers', () => {
    expect(() => ditherRgba(new Uint8ClampedArray(3), 1, 1)).toThrow('Not enough pixel data');
  });
});

describe('fitWithin', () => {
  it('fits into 256 × 256 keeping aspect, never upscales', () => {
    expect(IMAGE_FIT).toBe(256);
    expect(fitWithin(1024, 512)).toEqual({ w: 256, h: 128 });
    expect(fitWithin(300, 1200)).toEqual({ w: 64, h: 256 });
    expect(fitWithin(100, 50)).toEqual({ w: 100, h: 50 });
  });

  it('enforces the minimum size and handles degenerate input', () => {
    expect(fitWithin(5000, 10)).toEqual({ w: 256, h: MIN_SIZE });
    expect(fitWithin(0, 10)).toEqual({ w: MIN_SIZE, h: MIN_SIZE });
  });
});
