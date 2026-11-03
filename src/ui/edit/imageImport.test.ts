// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { checkImageFile, ImageImportError, importImage, MAX_IMAGE_BYTES, type ImportDeps } from './imageImport.js';
import { readSource } from '../browse/readSource.js';

/** A fake decoder: a w×h picture whose left half is black and right half white. */
function fakeDeps(width: number, height: number) {
  const draws: [number, number][] = [];
  const close = vi.fn();
  const deps: ImportDeps = {
    decode: async () => ({
      width,
      height,
      draw: (w, h) => {
        draws.push([w, h]);
        const px = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const v = x < w / 2 ? 0 : 255;
          px.set([v, v, v, 255], (y * w + x) * 4);
        }
        return px;
      },
      close,
    }),
  };
  return { deps, draws, close };
}

const file = (type: string, size = 10) => new File([new Uint8Array(size)], 'x', { type });

describe('importImage', () => {
  it('"Add image" fits into 256 × 256 and returns a PNG data URL at that size', async () => {
    const { deps, draws, close } = fakeDeps(1000, 500);
    const out = await importImage(file('image/png'), 'fit', deps);
    expect([out.w, out.h]).toEqual([256, 128]);
    expect(draws).toEqual([[256, 128]]);
    expect(out.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(close).toHaveBeenCalled();
  });

  it('"Import…" dithers at the given rect size', async () => {
    const { deps, draws } = fakeDeps(10, 10);
    const out = await importImage(file('image/jpeg'), { w: 33.4, h: 2 }, deps);
    expect([out.w, out.h]).toEqual([33, 4]);
    expect(draws).toEqual([[33, 4]]);
  });

  it('rejects non-images and files over 5 MB with plain-English reasons', async () => {
    const { deps } = fakeDeps(10, 10);
    await expect(importImage(file('text/plain'), 'fit', deps)).rejects.toThrow('the file is not an image');
    expect(() => checkImageFile(file('image/png', MAX_IMAGE_BYTES + 1))).toThrow('the file is larger than 5 MB');
    expect(() => checkImageFile(file('image/png', MAX_IMAGE_BYTES))).not.toThrow();
  });

  it('decode failures become a readable ImageImportError', async () => {
    const deps: ImportDeps = { decode: async () => { throw new DOMException('bad'); } };
    const err = await importImage(file('image/png'), 'fit', deps).catch(e => e);
    expect(err).toBeInstanceOf(ImageImportError);
    expect(err.message).toBe('the image could not be read');
  });

  it('never references network APIs', async () => {
    const src = await readSource('./imageImport.ts', import.meta.url);
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|new WebSocket/);
  });
});
