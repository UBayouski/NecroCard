import { describe, expect, it } from 'vitest';
import { CACHE_IMMUTABLE, CACHE_REVALIDATE, createStaticFiles } from './static.js';

const ROOT = 'server/fixtures/static';
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('createStaticFiles', () => {
  const serve = createStaticFiles(ROOT);

  it('serves index.html for / with no-cache', async () => {
    const res = await serve('GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(res.headers['Cache-Control']).toBe(CACHE_REVALIDATE);
    expect(res.headers['Content-Length']).toBe(String(res.body.byteLength));
    expect(decode(res.body)).toContain('fixture index');
  });

  it('serves hashed assets as immutable with their media type', async () => {
    const js = await serve('GET', '/assets/index-abc123.js?v=1');
    expect([js.status, js.headers['Content-Type'], js.headers['Cache-Control']]).toEqual([
      200, 'text/javascript; charset=utf-8', CACHE_IMMUTABLE,
    ]);
    expect(decode(js.body)).toContain('fixture asset');
    const css = await serve('GET', '/assets/index-abc123.css');
    expect(css.headers['Content-Type']).toBe('text/css; charset=utf-8');
  });

  it('files outside /assets/ are revalidated', async () => {
    const res = await serve('GET', '/favicon.ico');
    expect([res.status, res.headers['Content-Type'], res.headers['Cache-Control']]).toEqual([
      200, 'image/x-icon', CACHE_REVALIDATE,
    ]);
  });

  it('a page path without an extension falls back to index.html (no-cache)', async () => {
    for (const path of ['/stacks/quiz', '/s%C3%A9ance']) {
      const res = await serve('GET', path);
      expect(res.status, path).toBe(200);
      expect(res.headers['Cache-Control']).toBe(CACHE_REVALIDATE);
      expect(decode(res.body)).toContain('fixture index');
    }
  });

  it('a missing file with an extension is 404, and so is a directory without index.html', async () => {
    expect((await serve('GET', '/assets/')).status).toBe(404);
    const res = await serve('GET', '/assets/index-old.js');
    expect(res.status).toBe(404);
    expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
  });

  it('paths that escape the root are 404', async () => {
    const escapes = ['/../package.json', '/assets/../../package.json', '/..%2F..%2Fpackage.json', '/%2e%2e/package.json'];
    for (const path of escapes) expect((await serve('GET', path)).status, path).toBe(404);
  });

  it('bad encodings and NUL bytes are 400', async () => {
    expect((await serve('GET', '/%E0%A4%A')).status).toBe(400);
    expect((await serve('GET', '/index.html%00.js')).status).toBe(400);
  });

  it('HEAD sends the headers and no body; other methods are 405', async () => {
    const head = await serve('HEAD', '/index.html');
    expect(head.status).toBe(200);
    expect(head.body.byteLength).toBe(0);
    expect(Number(head.headers['Content-Length'])).toBeGreaterThan(0);
    const post = await serve('POST', '/index.html');
    expect([post.status, post.headers.Allow]).toEqual([405, 'GET, HEAD']);
  });

  it('a missing root serves nothing', async () => {
    const missing = createStaticFiles('server/fixtures/does-not-exist');
    expect((await missing('GET', '/')).status).toBe(404);
    expect((await missing('GET', '/anything')).status).toBe(404);
  });
});
