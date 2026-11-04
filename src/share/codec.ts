// Share-by-URL codec (sharing REQ-1), pure and dependency-free. Encodes a stack to a URL-fragment-safe string:
// canonical JSON -> UTF-8 -> deflate-raw -> base64url. Decode reverses it and validates. Works in the browser and
// in Node 22 (both provide CompressionStream, DecompressionStream, btoa/atob). Imports only src/model/.
import type { Stack } from '../model/types.js';
import { serializeStack } from '../model/serialize.js';
import { validateStack } from '../model/validate.js';

export class ShareDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ShareDecodeError';
  }
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const CHUNK = 8192;

/** Base64url without padding: standard base64, then +/ -> -_ and strip =. */
function toBase64Url(bytes: Uint8Array): string {
  // Build the binary string in chunks; spreading the whole array overflows the call stack for a
  // stack carrying a full-card image.
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A Uint8Array whose buffer is a plain ArrayBuffer (TS's stream types reject SharedArrayBuffer-backed views). */
function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  if (source instanceof Uint8Array && source.buffer instanceof ArrayBuffer) {
    return source as Uint8Array<ArrayBuffer>;
  }
  const buffer = source instanceof Uint8Array ? source.slice().buffer : source;
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Run bytes through a (de)compression stream and collect the output. */
async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A DecompressionStream error rejects the write/close promises and the readable alike. We only
  // await the readable (through arrayBuffer), so swallow the write/close rejections here to keep
  // the failure to a single rejection and avoid an unhandled-rejection warning on a bad link.
  void writer.write(bytes).catch(() => {});
  void writer.close().catch(() => {});
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function encodeStack(stack: Stack): Promise<string> {
  const bytes = new TextEncoder().encode(serializeStack(stack));
  const deflated = await pipe(toBytes(bytes), new CompressionStream('deflate-raw'));
  return toBase64Url(deflated);
}

export async function decodeStack(text: string): Promise<Stack> {
  const trimmed = text.trim();
  if (!BASE64URL.test(trimmed) || trimmed === '') {
    throw new ShareDecodeError('That shared link is not a valid NecroCard stack.');
  }
  let json: string;
  try {
    const inflated = await pipe(fromBase64Url(trimmed), new DecompressionStream('deflate-raw'));
    json = new TextDecoder().decode(inflated);
  } catch (cause) {
    throw new ShareDecodeError('That shared stack could not be read.', { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new ShareDecodeError('That shared stack could not be read.', { cause });
  }
  try {
    return validateStack(parsed);
  } catch (cause) {
    throw new ShareDecodeError('That shared link is not a valid NecroCard stack.', { cause });
  }
}
