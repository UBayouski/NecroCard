import { describe, expect, it } from 'vitest';
import { clientIp, maskIp, plainHeaders, readBody, type BodySource } from './adapter.js';

/** A body source that emits the given chunks on the next tick. */
function source(chunks: Uint8Array[]): BodySource {
  const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
  const self = {
    on(event: string, listener: (arg?: never) => void) {
      (listeners[event] ??= []).push(listener as (arg?: unknown) => void);
      return self;
    },
  };
  setTimeout(() => {
    for (const c of chunks) for (const l of listeners.data ?? []) l(c);
    for (const l of listeners.end ?? []) l();
  });
  return self as BodySource;
}

describe('adapter', () => {
  it('clientIp takes the first X-Forwarded-For entry, else the socket', () => {
    expect(clientIp({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }, '10.0.0.2')).toBe('203.0.113.7');
    expect(clientIp({ 'x-forwarded-for': ['198.51.100.1', '10.0.0.1'] }, undefined)).toBe('198.51.100.1');
    expect(clientIp({}, '::1')).toBe('::1');
    expect(clientIp({}, undefined)).toBe('unknown');
  });

  it('maskIp keeps only the first half', () => {
    expect(maskIp('203.0.113.7')).toBe('203.0.x.x');
    expect(maskIp('::ffff:203.0.113.7')).toBe('203.0.x.x');
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:x');
    expect(maskIp('::1')).toBe('x');
    expect(maskIp('unknown')).toBe('x');
  });

  it('plainHeaders lower-cases names and joins arrays', () => {
    expect(plainHeaders({ Origin: 'http://a', 'x-a': ['1', '2'] })).toEqual({ origin: 'http://a', 'x-a': '1, 2' });
  });

  it('readBody decodes UTF-8 across chunk boundaries', async () => {
    const bytes = new TextEncoder().encode('{"prompt":"ghöst 👻"}');
    const chunks = [bytes.slice(0, 15), bytes.slice(15, 17), bytes.slice(17)];
    expect(await readBody(source(chunks))).toEqual({ body: '{"prompt":"ghöst 👻"}', tooLarge: false });
  });

  it('readBody flags a body over the limit and keeps nothing', async () => {
    const chunk = new Uint8Array(6);
    expect(await readBody(source([chunk, chunk]), 10)).toEqual({ body: '', tooLarge: true });
    expect(await readBody(source([chunk]), 6)).toEqual({ body: '\0'.repeat(6), tooLarge: false });
  });
});
