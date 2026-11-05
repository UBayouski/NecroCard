// Serves the built app (Vite's dist/) from the same Node process as /api, so one Render web service hosts both.
// Plain function in, plain response out, like handler.ts; main.ts routes every non-/api path here.
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

export interface StaticResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Vite hashes everything under /assets/, so browsers may keep those forever; everything else is revalidated. */
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_REVALIDATE = 'no-cache';

const encoder = new TextEncoder();

function text(status: number, body: string, headers: Record<string, string> = {}): StaticResponse {
  const bytes = encoder.encode(body);
  return {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(bytes.byteLength), ...headers },
    body: bytes,
  };
}

async function fileAt(path: string): Promise<Uint8Array | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

/**
 * Creates a GET/HEAD server for the files under `root`. A path that is not a file and has no extension (a page
 * URL) gets index.html, so the app can own its routes; anything else that is missing is 404. Paths that escape
 * `root` are 404 too.
 */
export function createStaticFiles(root: string): (method: string, path: string) => Promise<StaticResponse> {
  const base = resolve(root);
  const inside = (file: string) => file === base || file.startsWith(base + sep);

  return async (method, path) => {
    const upper = method.toUpperCase();
    if (upper !== 'GET' && upper !== 'HEAD') return text(405, 'Method not allowed.', { Allow: 'GET, HEAD' });

    let pathname = path.split('?')[0].split('#')[0];
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      return text(400, 'Bad request.');
    }
    if (pathname.includes('\0')) return text(400, 'Bad request.');
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
    if (pathname.endsWith('/')) pathname += 'index.html';

    const file = resolve(base, `.${pathname}`);
    if (!inside(file)) return text(404, 'Not found.');

    let served = file;
    let body = await fileAt(file);
    if (body === null) {
      if (extname(pathname) !== '') return text(404, 'Not found.');
      served = resolve(base, 'index.html');
      body = await fileAt(served);
      if (body === null) return text(404, 'Not found.');
    }

    const hashed = served === file && pathname.startsWith('/assets/');
    const headers: Record<string, string> = {
      'Content-Type': TYPES[extname(served).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      'Cache-Control': hashed ? CACHE_IMMUTABLE : CACHE_REVALIDATE,
    };
    return { status: 200, headers, body: upper === 'HEAD' ? new Uint8Array(0) : body };
  };
}
