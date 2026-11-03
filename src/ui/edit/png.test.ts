import { describe, expect, it } from 'vitest';
import {
  adler32, crc32, encodeBitsPng, encodeBitsPngBytes, MAX_STORED_BLOCK, storedDeflate,
} from './png.js';

interface Chunk { type: string; data: Uint8Array; crc: number }

function readChunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  for (let p = 8; p < png.length;) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    const data = png.subarray(p + 8, p + 8 + len);
    const crc = view.getUint32(p + 8 + len);
    expect(crc).toBe(crc32(png.subarray(p + 4, p + 8 + len)));
    chunks.push({ type, data, crc });
    p += 12 + len;
  }
  return chunks;
}

/** Parse a zlib stream of stored blocks back into raw bytes, checking every header. */
function inflateStored(z: Uint8Array): { raw: Uint8Array; blocks: { len: number; final: boolean }[] } {
  expect(z[0]).toBe(0x78);
  expect(((z[0] << 8) | z[1]) % 31).toBe(0);
  const parts: Uint8Array[] = [];
  const blocks: { len: number; final: boolean }[] = [];
  let p = 2;
  for (;;) {
    const header = z[p++];
    expect(header & 0b110).toBe(0); // BTYPE 00
    const len = z[p] | (z[p + 1] << 8);
    const nlen = z[p + 2] | (z[p + 3] << 8);
    expect(nlen).toBe(~len & 0xffff);
    p += 4;
    parts.push(z.subarray(p, p + len));
    p += len;
    blocks.push({ len, final: (header & 1) === 1 });
    if (header & 1) break;
  }
  const raw = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let q = 0;
  for (const x of parts) { raw.set(x, q); q += x.length; }
  const adler = ((z[p] << 24) | (z[p + 1] << 16) | (z[p + 2] << 8) | z[p + 3]) >>> 0;
  expect(adler).toBe(adler32(raw));
  expect(p + 4).toBe(z.length);
  return { raw, blocks };
}

/** Decode our own PNG back to 1-bit pixels (1 = black). */
function decodeBits(png: Uint8Array): { w: number; h: number; bits: Uint8Array; blocks: number } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = readChunks(png);
  expect(chunks.map(c => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
  const w = ihdr.getUint32(0);
  const h = ihdr.getUint32(4);
  expect([ihdr.getUint8(8), ihdr.getUint8(9), ihdr.getUint8(10), ihdr.getUint8(11), ihdr.getUint8(12)]).toEqual([1, 0, 0, 0, 0]);
  const { raw, blocks } = inflateStored(chunks[1].data);
  const rowBytes = Math.ceil(w / 8);
  expect(raw.length).toBe((rowBytes + 1) * h);
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (rowBytes + 1)]).toBe(0);
    for (let x = 0; x < w; x++) {
      const white = raw[y * (rowBytes + 1) + 1 + (x >> 3)] & (0x80 >> (x & 7));
      bits[y * w + x] = white ? 0 : 1;
    }
  }
  return { w, h, bits, blocks: blocks.length };
}

describe('checksums', () => {
  it('CRC-32 and Adler-32 match the standard test vectors', () => {
    const text = new TextEncoder().encode('123456789');
    expect(crc32(text)).toBe(0xcbf43926);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
  });
});

describe('storedDeflate', () => {
  it('splits data into stored blocks of at most 65,535 bytes, BFINAL only on the last', () => {
    const raw = new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff);
    const { raw: back, blocks } = inflateStored(storedDeflate(raw));
    expect(blocks).toEqual([
      { len: MAX_STORED_BLOCK, final: false },
      { len: MAX_STORED_BLOCK, final: false },
      { len: MAX_STORED_BLOCK, final: false },
      { len: 200_000 - 3 * MAX_STORED_BLOCK, final: true },
    ]);
    expect(back).toEqual(raw);
  });

  it('exactly one full block, and the empty input', () => {
    expect(inflateStored(storedDeflate(new Uint8Array(MAX_STORED_BLOCK))).blocks).toEqual([{ len: MAX_STORED_BLOCK, final: true }]);
    expect(inflateStored(storedDeflate(new Uint8Array(0))).blocks).toEqual([{ len: 0, final: true }]);
  });
});

describe('encodeBitsPng', () => {
  it('round-trips a small odd-width bitmap', () => {
    const w = 11;
    const h = 3;
    const bits = new Uint8Array(w * h).map((_, i) => (i % 3 === 0 ? 1 : 0));
    const out = decodeBits(encodeBitsPngBytes(bits, w, h));
    expect([out.w, out.h]).toEqual([w, h]);
    expect(out.bits).toEqual(bits);
  });

  it('round-trips a full 512 × 342 card-sized bitmap (22,230 raw bytes, one block)', () => {
    const w = 512;
    const h = 342;
    const bits = new Uint8Array(w * h).map((_, i) => ((i % w) ^ Math.floor(i / w)) & 1);
    const out = decodeBits(encodeBitsPngBytes(bits, w, h));
    expect(out.bits).toEqual(bits);
    expect(out.blocks).toBe(1);
  });

  it('returns a base64 PNG data URL', () => {
    const url = encodeBitsPng(new Uint8Array(4), 2, 2);
    expect(url.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
    const bytes = Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0));
    expect(decodeBits(bytes).bits).toEqual(new Uint8Array(4));
  });

  it('rejects empty sizes and short data', () => {
    expect(() => encodeBitsPng(new Uint8Array(0), 0, 1)).toThrow('at least 1 × 1');
    expect(() => encodeBitsPng(new Uint8Array(1), 2, 2)).toThrow('Not enough pixel data');
  });
});
