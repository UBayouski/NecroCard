import { BAYER_8 } from '../patterns.js';
import { MIN_SIZE } from './geometry.js';

/** Largest side of an image added with "Add image" (REQ-4.4, open question 8). */
export const IMAGE_FIT = 256;

/**
 * Scale (w, h) down to fit inside max × max keeping the aspect ratio; never upscales.
 * Both sides are whole pixels and at least MIN_SIZE.
 */
export function fitWithin(w: number, h: number, max: number = IMAGE_FIT): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: MIN_SIZE, h: MIN_SIZE };
  const k = Math.min(1, max / w, max / h);
  return {
    w: Math.max(MIN_SIZE, Math.min(max, Math.round(w * k))),
    h: Math.max(MIN_SIZE, Math.min(max, Math.round(h * k))),
  };
}

/**
 * Convert RGBA pixels to 1-bit with the classic 8 × 8 ordered (Bayer) dither.
 * Returns one byte per pixel, row-major: 1 = black, 0 = white. Pixels with alpha < 128 are white.
 */
export function ditherRgba(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  if (rgba.length < w * h * 4) throw new Error('Not enough pixel data');
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < 128) continue;
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      const threshold = (BAYER_8[(y % 8) * 8 + (x % 8)] + 0.5) * 4;
      if (lum < threshold) bits[y * w + x] = 1;
    }
  }
  return bits;
}
