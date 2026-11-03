// Minimal 1-bit grayscale PNG encoder: no compression library, deterministic output.

/** Largest payload of one stored (uncompressed) deflate block. */
export const MAX_STORED_BLOCK = 65535;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const v of bytes) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * A zlib stream holding `raw` in stored deflate blocks of at most 65,535 bytes each, written in
 * a loop; BFINAL is set only on the last block. An empty input is one empty final block.
 */
export function storedDeflate(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_STORED_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let p = 0;
  out[p++] = 0x78; // CMF: deflate, 32K window
  out[p++] = 0x01; // FLG: no dictionary, fastest; (0x7801 % 31 === 0)
  for (let i = 0; i < blocks; i++) {
    const start = i * MAX_STORED_BLOCK;
    const len = Math.min(MAX_STORED_BLOCK, raw.length - start);
    out[p++] = i === blocks - 1 ? 1 : 0; // BFINAL, BTYPE = 00 (stored)
    out[p++] = len & 0xff;
    out[p++] = len >>> 8;
    out[p++] = ~len & 0xff;
    out[p++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), p);
    p += len;
  }
  const adler = adler32(raw);
  out[p++] = adler >>> 24;
  out[p++] = (adler >>> 16) & 0xff;
  out[p++] = (adler >>> 8) & 0xff;
  out[p] = adler & 0xff;
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode 1-bit pixels (1 = black, row-major) as PNG bytes. */
export function encodeBitsPngBytes(bits: Uint8Array, w: number, h: number): Uint8Array {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error('Image size must be at least 1 × 1');
  if (bits.length < w * h) throw new Error('Not enough pixel data');
  const rowBytes = Math.ceil(w / 8);
  const raw = new Uint8Array((rowBytes + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      // PNG grayscale 1-bit: 1 = white, so a black pixel stays 0.
      if (bits[y * w + x] === 0) raw[row + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // colour type: grayscale
  // compression, filter, interlace: 0
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', storedDeflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Encode 1-bit pixels as a `data:image/png;base64,…` URL. */
export function encodeBitsPng(bits: Uint8Array, w: number, h: number): string {
  return `data:image/png;base64,${toBase64(encodeBitsPngBytes(bits, w, h))}`;
}
