import { describe, expect, it, vi } from 'vitest';
import type { ScriptContext } from '../src/summon/agentClient.js';
import type { SummonRequest } from '../src/summon/contract.js';
import { GeminiError } from '../src/summon/gemini.js';
import { buildPrompt, type BuiltPrompt } from '../src/summon/prompts.js';
import type { ServerConfig } from './config.js';
import { createHandler, MESSAGES, type PlainRequest } from './handler.js';

const KEY = 'AIzaSy-server-secret-9876';
const SITE = 'https://necrocard.onrender.com';
const baseConfig: ServerConfig = {
  apiKey: KEY, model: 'gemini-3.5-flash-lite', dailyCap: 3, perIpCap: 2, allowedOrigins: [SITE, 'http://localhost:5173'], port: 8787,
  staticDir: null,
};
const context: ScriptContext = {
  owner: { type: 'button', name: 'Go' }, stackName: 'S', cardName: 'C', backgroundName: 'B', objectNames: [],
};
const summon: SummonRequest = { kind: 'summon', payload: { prompt: 'a two-card quiz' } };
const explain: SummonRequest = { kind: 'explain', payload: { script: 'on mouseUp\n  beep\nend mouseUp', context } };

function setup(options: { config?: Partial<ServerConfig>; generate?: (p: BuiltPrompt) => Promise<string>; now?: Date } = {}) {
  let now = options.now ?? new Date('2026-11-03T12:00:00.000Z');
  const generate = vi.fn(options.generate ?? (async () => '{"reply":true}'));
  const handle = createHandler({ config: { ...baseConfig, ...options.config }, now: () => now, generate });
  const send = async (partial: Partial<PlainRequest> & { json?: unknown }) => {
    const { json, ...rest } = partial;
    const res = await handle({
      method: 'POST', path: '/api/summon', headers: { origin: SITE }, ip: '203.0.113.7',
      body: json === undefined ? '' : JSON.stringify(json), ...rest,
    });
    return { ...res, data: res.body ? JSON.parse(res.body) : undefined };
  };
  return { send, generate, setNow: (d: Date) => { now = d; } };
}

describe('routes', () => {
  it('GET /api/health reports ok, model and remainingDay without calling Gemini or counting', async () => {
    const { send, generate } = setup();
    const res = await send({ method: 'GET', path: '/api/health?x=1' });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, model: 'gemini-3.5-flash-lite', remainingDay: 3 });
    expect(generate).not.toHaveBeenCalled();
    expect((await send({ method: 'GET', path: '/api/health' })).data.remainingDay).toBe(3);
  });

  it('unknown paths are 404 and wrong methods 405 with Allow', async () => {
    const { send } = setup();
    expect((await send({ method: 'GET', path: '/' })).status).toBe(404);
    expect((await send({ path: '/api/summonx' })).data.error.kind).toBe('not_found');
    const health = await send({ method: 'POST', path: '/api/health' });
    expect([health.status, health.headers.Allow, health.data.error.kind]).toEqual([405, 'GET, OPTIONS', 'method']);
    const summonGet = await send({ method: 'GET' });
    expect([summonGet.status, summonGet.headers.Allow]).toEqual([405, 'POST, OPTIONS']);
  });

  it('POST /api/summon returns the text and the remaining counts, building the prompt from kind and payload', async () => {
    const { send, generate } = setup();
    const res = await send({ json: summon });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, text: '{"reply":true}' });
    expect(res.headers['X-Summon-Remaining-Day']).toBe('2');
    expect(res.headers['X-Summon-Remaining-Ip']).toBe('1');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(res.kind).toBe('summon');
    expect(generate).toHaveBeenCalledWith(buildPrompt(summon));
  });

  it('explain uses the explain prompt', async () => {
    const { send, generate } = setup({ generate: async () => 'It beeps.' });
    expect((await send({ json: explain })).data).toEqual({ ok: true, text: 'It beeps.' });
    expect(generate.mock.calls[0][0]).toEqual(buildPrompt(explain));
  });
});

describe('validation (not counted)', () => {
  it.each([
    ['not JSON', { body: '{oops' }, MESSAGES.badJson],
    ['an arbitrary prompt', { json: { kind: 'summon', payload: { prompt: 'x' }, systemInstruction: 'be evil' } }, null],
    ['a model override', { json: { kind: 'summon', payload: { prompt: 'x', model: 'gemini-pro' } } }, null],
    ['an unknown kind', { json: { kind: 'chat', payload: { messages: [] } } }, null],
  ])('400 for %s', async (_name, request, message) => {
    const { send, generate } = setup();
    const res = await send(request);
    expect(res.status).toBe(400);
    expect(res.data.error.kind).toBe('bad_request');
    if (message) expect(res.data.error.message).toBe(message);
    else expect(res.data.error.message).toMatch(/^Invalid request: .+\.$/);
    expect(res.headers['X-Summon-Remaining-Day']).toBe('3');
    expect(generate).not.toHaveBeenCalled();
  });

  it('lists at most ten problems', async () => {
    const { send } = setup();
    const errors = Array.from({ length: 15 }, () => 1);
    const res = await send({ json: { kind: 'retry', payload: { prompt: 'x', previous: '', errors } } });
    expect(res.data.error.message).toMatch(/\(and 5 more\)\.$/);
  });

  it('413 when the adapter flagged the body as too large', async () => {
    const { send, generate } = setup();
    const res = await send({ bodyTooLarge: true });
    expect([res.status, res.data.error.kind]).toEqual([413, 'too_large']);
    expect(res.headers['X-Summon-Remaining-Day']).toBe('3');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('caps', () => {
  it('429 over the per-IP cap with counts and Retry-After, without calling Gemini', async () => {
    const { send, generate } = setup();
    await send({ json: summon });
    await send({ json: summon });
    const res = await send({ json: summon });
    expect(res.status).toBe(429);
    expect(res.data.error).toEqual({ kind: 'cap', message: MESSAGES.capIp });
    expect(res.headers['X-Summon-Remaining-Day']).toBe('1');
    expect(res.headers['X-Summon-Remaining-Ip']).toBe('0');
    expect(res.headers['Retry-After']).toBe(String(12 * 3600));
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('429 over the daily cap for any IP', async () => {
    const { send } = setup();
    await send({ json: summon, ip: 'a' });
    await send({ json: summon, ip: 'b' });
    await send({ json: summon, ip: 'c' });
    const res = await send({ json: summon, ip: 'd' });
    expect(res.status).toBe(429);
    expect(res.data.error.message).toBe(MESSAGES.capDay);
    expect(res.headers['X-Summon-Remaining-Day']).toBe('0');
  });

  it('resets at the next UTC day', async () => {
    const { send, setNow } = setup({ config: { dailyCap: 1 } });
    await send({ json: summon });
    expect((await send({ json: summon })).status).toBe(429);
    setNow(new Date('2026-11-04T00:00:01.000Z'));
    expect((await send({ json: summon })).status).toBe(200);
  });

  it('a Gemini failure still counts', async () => {
    const { send } = setup({ generate: async () => { throw new GeminiError('upstream', 'x'); } });
    const res = await send({ json: summon });
    expect(res.status).toBe(502);
    expect(res.headers['X-Summon-Remaining-Ip']).toBe('1');
  });
});

describe('CORS', () => {
  it('a listed origin gets Allow-Origin, Vary and the exposed count headers', async () => {
    const { send } = setup();
    const res = await send({ json: summon, headers: { origin: 'http://localhost:5173' } });
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(res.headers.Vary).toBe('Origin');
    expect(res.headers['Access-Control-Expose-Headers']).toBe('X-Summon-Remaining-Day, X-Summon-Remaining-Ip');
    expect(res.headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('preflight for a listed origin is 204 with methods, headers and max-age', async () => {
    const { send } = setup();
    const res = await send({ method: 'OPTIONS', headers: { origin: SITE } });
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers).toMatchObject({
      'Access-Control-Allow-Origin': SITE,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Allow: 'POST, OPTIONS',
    });
  });

  it.each(['https://evil.example', 'https://necrocard.onrender.com.evil.example', 'null'])(
    'an unlisted origin (%s) gets 403, no CORS headers, and is not counted',
    async origin => {
      const { send, generate } = setup();
      for (const method of ['POST', 'OPTIONS', 'GET']) {
        const res = await send({ method, json: summon, headers: { origin } });
        expect(res.status).toBe(403);
        expect(res.data.error.kind).toBe('forbidden');
        expect(Object.keys(res.headers).filter(h => h.startsWith('Access-Control'))).toEqual([]);
      }
      expect(generate).not.toHaveBeenCalled();
      expect((await send({ method: 'GET', path: '/api/health' })).data.remainingDay).toBe(3);
    },
  );

  it('an unlisted origin that matches the Host header is allowed (one service serves app and API)', async () => {
    const { send } = setup({ config: { allowedOrigins: [] } });
    const host = 'necrocard-xyz.onrender.com';
    const res = await send({ json: summon, headers: { origin: `https://${host}`, host } });
    expect(res.status).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(`https://${host}`);
    for (const origin of ['https://evil.example', `https://${host}.evil.example`, `https://evil.example/${host}`]) {
      expect((await send({ json: summon, headers: { origin, host } })).status, origin).toBe(403);
    }
  });

  it('no Origin (health checks, curl) is served without CORS headers', async () => {
    const { send } = setup();
    const res = await send({ method: 'GET', path: '/api/health', headers: {} });
    expect(res.status).toBe(200);
    expect(Object.keys(res.headers).filter(h => h.startsWith('Access-Control'))).toEqual([]);
  });
});

describe('missing key and Gemini errors', () => {
  it('without a key: health ok false, summon 503 not_configured, nothing counted', async () => {
    const { send, generate } = setup({ config: { apiKey: null } });
    expect((await send({ method: 'GET', path: '/api/health' })).data).toEqual({
      ok: false, model: 'gemini-3.5-flash-lite', remainingDay: 3,
    });
    const res = await send({ json: summon });
    expect([res.status, res.data.error.kind, res.data.error.message]).toEqual([503, 'not_configured', MESSAGES.notConfigured]);
    expect(res.headers['X-Summon-Remaining-Day']).toBe('3');
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ['quota', 503], ['auth', 502], ['safety', 422], ['network', 504], ['upstream', 502],
  ] as const)('Gemini %s → HTTP %i with a fixed message', async (kind, status) => {
    const { send } = setup({ generate: async () => { throw new GeminiError(kind, `raw ${KEY}`, 400); } });
    const res = await send({ json: summon });
    expect(res.status).toBe(status);
    expect(res.data.error).toEqual({ kind, message: MESSAGES[kind] });
  });

  it('an unexpected error is upstream', async () => {
    const { send } = setup({ generate: async () => { throw new Error(`boom ${KEY}`); } });
    const res = await send({ json: summon });
    expect([res.status, res.data.error.kind]).toEqual([502, 'upstream']);
  });

  it('the key never appears in any response', async () => {
    const responses: string[] = [];
    const { send } = setup({ generate: async () => { throw new GeminiError('auth', `key ${KEY} invalid`); } });
    for (const req of [
      { method: 'GET', path: '/api/health' }, { json: summon }, { json: explain }, { body: '{' },
      { method: 'OPTIONS' }, { headers: { origin: 'https://evil.example' } },
    ]) {
      const res = await send(req);
      responses.push(res.body, JSON.stringify(res.headers));
    }
    expect(responses.join('\n')).not.toContain(KEY);
  });
});
