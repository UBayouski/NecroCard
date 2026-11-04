import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SummonRequest } from './contract.js';
import { createServerTransport, normalizeApiBase, UNREACHABLE } from './serverTransport.js';
import { TransportError } from './transport.js';

const summon: SummonRequest = { kind: 'summon', payload: { prompt: 'a two-card quiz' } };

const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const counts = { 'X-Summon-Remaining-Day': '87', 'X-Summon-Remaining-Ip': '9' };
const fakeFetch = (response: Response) => vi.fn<typeof fetch>(async () => response);

async function failure(response: Response): Promise<TransportError> {
  const e = await createServerTransport('', { fetch: fakeFetch(response) }).send(summon).catch((err: unknown) => err);
  expect(e).toBeInstanceOf(TransportError);
  return e as TransportError;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('normalizeApiBase', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['  ', ''],
    ['necrocard-api.onrender.com', 'https://necrocard-api.onrender.com'],
    ['https://necrocard-api.onrender.com/', 'https://necrocard-api.onrender.com'],
    ['http://localhost:8787//', 'http://localhost:8787'],
  ])('%p → %p', (input, output) => {
    expect(normalizeApiBase(input)).toBe(output);
  });
});

describe('ServerTransport', () => {
  it('posts {kind, payload} as JSON without credentials or a key', async () => {
    const f = fakeFetch(respond({ ok: true, text: '{}' }, 200, counts));
    const transport = createServerTransport('https://necrocard-api.onrender.com/', { fetch: f });
    expect(transport.path).toBe('server');
    const reply = await transport.send(summon);
    expect(reply).toEqual({ text: '{}', remaining: { day: 87, ip: 9 } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://necrocard-api.onrender.com/api/summon');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('omit');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual(summon);
  });

  it('uses a relative URL with an empty base (Vite proxy in dev)', async () => {
    const f = fakeFetch(respond({ ok: true, text: 'x' }));
    const reply = await createServerTransport('', { fetch: f }).send(summon);
    expect(f.mock.calls[0][0]).toBe('/api/summon');
    expect(reply.remaining).toBeUndefined();
  });

  it('validates the request before sending', async () => {
    const f = fakeFetch(respond({ ok: true, text: 'x' }));
    const e = await createServerTransport('', { fetch: f })
      .send({ kind: 'summon', payload: { prompt: '' } })
      .catch(err => err);
    expect(e).toBeInstanceOf(TransportError);
    expect(e.kind).toBe('bad_request');
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    ['cap', 429, 'cap'],
    ['bad_request', 400, 'bad_request'],
    ['too_large', 413, 'bad_request'],
    ['forbidden', 403, 'forbidden'],
    ['not_configured', 503, 'not_configured'],
    ['quota', 503, 'quota'],
    ['auth', 502, 'auth'],
    ['safety', 422, 'safety'],
    ['network', 504, 'network'],
    ['upstream', 502, 'upstream'],
  ] as const)('server error %s (HTTP %i) → %s with the server message and counts', async (kind, status, mapped) => {
    const e = await failure(respond({ ok: false, error: { kind, message: `Message for ${kind}.` } }, status, counts));
    expect(e.kind).toBe(mapped);
    expect(e.message).toBe(`Message for ${kind}.`);
    expect(e.remaining).toEqual({ day: 87, ip: 9 });
  });

  it.each([
    ['HTML error page', respond('<html>502</html>', 502)],
    ['unknown error kind', respond({ ok: false, error: { kind: 'weird', message: 'x' } }, 500)],
    ['200 without text', respond({ ok: true }, 200)],
    ['200 with ok false', respond({ ok: false }, 200)],
  ])('%s → network "not reachable"', async (_name, response) => {
    const e = await failure(response);
    expect(e.kind).toBe('network');
    expect(e.message).toBe(UNREACHABLE);
  });

  it('fetch throwing → network "not reachable"', async () => {
    const f = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const e = await createServerTransport('', { fetch: f }).send(summon).catch(err => err);
    expect(e.kind).toBe('network');
    expect(e.message).toBe(UNREACHABLE);
  });

  const hanging = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));

  it('times out as network', async () => {
    vi.useFakeTimers();
    const pending = createServerTransport('', { fetch: hanging, timeoutMs: 500 }).send(summon).catch(e => e);
    await vi.advanceTimersByTimeAsync(500);
    const e = await pending;
    expect(e.kind).toBe('network');
    expect(e.message).toBe('The NecroCard server did not answer in time.');
  });

  it('the caller aborting → AbortError', async () => {
    const c = new AbortController();
    const pending = createServerTransport('', { fetch: hanging }).send(summon, c.signal).catch(e => e);
    c.abort();
    const e = await pending;
    expect(e).not.toBeInstanceOf(TransportError);
    expect(e.name).toBe('AbortError');
  });
});
