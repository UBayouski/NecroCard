import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEMINI_MODEL, generate, GeminiError, generateContentUrl, type GenerateOptions,
} from './gemini.js';
import type { BuiltPrompt } from './prompts.js';

async function ownSource(relative: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(p: URL, e: 'utf8'): string };
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const KEY = 'AIzaSy-test-secret-key-1234';
const jsonPrompt: BuiltPrompt = { systemInstruction: 'SYS', text: 'USER', json: true };
const textPrompt: BuiltPrompt = { systemInstruction: 'SYS2', text: 'USER2', json: false };

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (...texts: string[]) =>
  reply({ candidates: [{ content: { role: 'model', parts: texts.map(text => ({ text })) }, finishReason: 'STOP' }] });

function fakeFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn<typeof fetch>(async () => (typeof response === 'function' ? response() : response));
}

async function failure(options: Partial<GenerateOptions> & { fetch: typeof fetch }): Promise<GeminiError> {
  const e = await generate({ apiKey: KEY, prompt: jsonPrompt, ...options }).catch((err: unknown) => err);
  expect(e).toBeInstanceOf(GeminiError);
  expect((e as Error).message).not.toContain(KEY);
  return e as GeminiError;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('request', () => {
  it('posts to the default model with the key in the header only', async () => {
    const f = fakeFetch(ok('{}'));
    await generate({ apiKey: KEY, prompt: jsonPrompt, fetch: f });
    const [url, init] = f.mock.calls[0];
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(String(url)).not.toContain(KEY);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': KEY });
  });

  it('sends only systemInstruction, contents and responseMimeType (application/json for JSON prompts)', async () => {
    const f = fakeFetch(ok('{}'));
    await generate({ apiKey: KEY, prompt: jsonPrompt, fetch: f });
    expect(JSON.parse(f.mock.calls[0][1]?.body as string)).toEqual({
      systemInstruction: { parts: [{ text: 'SYS' }] },
      contents: [{ role: 'user', parts: [{ text: 'USER' }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
  });

  it('uses text/plain for explain and fix prompts, and the given model', async () => {
    const f = fakeFetch(ok('An explanation.'));
    await generate({ apiKey: KEY, prompt: textPrompt, model: 'gemini-3.8-flash', fetch: f });
    expect(f.mock.calls[0][0]).toMatch(/\/models\/gemini-3\.8-flash:generateContent$/);
    const body = JSON.parse(f.mock.calls[0][1]?.body as string);
    expect(body.generationConfig).toEqual({ responseMimeType: 'text/plain' });
    expect(JSON.stringify(body)).not.toMatch(/temperature|topP|topK|thinkingConfig|responseSchema|tools/);
  });

  it.each(['../x', 'gemini/x', 'Gemini', 'a?key=1', '', 'a b'])('rejects model id %p before fetching', async model => {
    const f = fakeFetch(ok('x'));
    const e = await failure({ model, fetch: f });
    expect(e.kind).toBe('upstream');
    expect(f).not.toHaveBeenCalled();
    expect(() => generateContentUrl(model)).toThrow(GeminiError);
  });
});

describe('result', () => {
  it('joins the text parts of the first candidate, skipping thought parts', async () => {
    const f = fakeFetch(reply({
      candidates: [
        { content: { parts: [{ text: 'thinking', thought: true }, { text: '{"a":' }, { text: '1}' }] } },
        { content: { parts: [{ text: 'second' }] } },
      ],
    }));
    expect(await generate({ apiKey: KEY, prompt: jsonPrompt, fetch: f })).toBe('{"a":1}');
  });

  it('promptFeedback.blockReason → safety', async () => {
    const e = await failure({ fetch: fakeFetch(reply({ promptFeedback: { blockReason: 'SAFETY' } })) });
    expect(e.kind).toBe('safety');
    expect(e.message).toBe('Gemini blocked the request (SAFETY).');
  });

  it('a non-enum block reason is not echoed', async () => {
    const e = await failure({ fetch: fakeFetch(reply({ promptFeedback: { blockReason: 'evil <b>text</b>' } })) });
    expect(e.message).toBe('Gemini blocked the request (OTHER).');
  });

  it('finishReason SAFETY → safety', async () => {
    const body = { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'SAFETY' }] };
    expect((await failure({ fetch: fakeFetch(reply(body)) })).kind).toBe('safety');
  });

  it.each([
    ['no candidates', {}],
    ['empty parts', { candidates: [{ content: { parts: [] } }] }],
    ['whitespace text', { candidates: [{ content: { parts: [{ text: '  ' }] } }] }],
    ['not an object', [1, 2]],
  ])('%s → upstream', async (_name, body) => {
    expect((await failure({ fetch: fakeFetch(reply(body)) })).kind).toBe('upstream');
  });

  it('a 2xx body that is not JSON → upstream', async () => {
    expect((await failure({ fetch: fakeFetch(new Response('<html>', { status: 200 })) })).kind).toBe('upstream');
  });
});

describe('HTTP errors', () => {
  const googleError = (code: number, status: string, message: string, reason?: string) =>
    reply({ error: { code, status, message, details: reason ? [{ reason }] : [] } }, code);

  it.each([
    [429, googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded'), 'quota'],
    [400, googleError(400, 'RESOURCE_EXHAUSTED', 'odd but quota'), 'quota'],
    [401, googleError(401, 'UNAUTHENTICATED', 'no'), 'auth'],
    [403, googleError(403, 'PERMISSION_DENIED', 'no'), 'auth'],
    [400, googleError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID'), 'auth'],
    [400, googleError(400, 'INVALID_ARGUMENT', 'Invalid JSON payload'), 'upstream'],
    [404, googleError(404, 'NOT_FOUND', 'models/x is not found'), 'upstream'],
    [500, googleError(500, 'INTERNAL', 'boom'), 'upstream'],
    [503, new Response('Service Unavailable', { status: 503 }), 'upstream'],
  ] as const)('HTTP %i → %s', async (status, response, kind) => {
    const e = await failure({ fetch: fakeFetch(response) });
    expect(e.kind).toBe(kind);
    expect(e.status).toBe(status);
    expect(e.message).toContain(`HTTP ${status}`);
  });

  it("does not echo Google's message text", async () => {
    const e = await failure({ fetch: fakeFetch(googleError(400, 'INVALID_ARGUMENT', `bad key ${KEY}`)) });
    expect(e.message).toBe('Gemini returned an error (HTTP 400).');
  });
});

describe('network, timeout and abort', () => {
  it('fetch throwing → network', async () => {
    const f = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const e = await failure({ fetch: f });
    expect(e.kind).toBe('network');
    expect(e.message).toBe('Gemini could not be reached.');
  });

  /** A fetch that never settles until its signal aborts. */
  const hanging = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));

  it('the timeout → network', async () => {
    vi.useFakeTimers();
    const pending = generate({ apiKey: KEY, prompt: jsonPrompt, fetch: hanging, timeoutMs: 1000 }).catch(e => e);
    await vi.advanceTimersByTimeAsync(999);
    await vi.advanceTimersByTimeAsync(1);
    const e = await pending;
    expect(e).toBeInstanceOf(GeminiError);
    expect(e.kind).toBe('network');
    expect(e.message).toBe('Gemini did not answer in time.');
  });

  it('the caller aborting → AbortError, not a GeminiError', async () => {
    const c = new AbortController();
    const pending = generate({ apiKey: KEY, prompt: jsonPrompt, fetch: hanging, signal: c.signal }).catch(e => e);
    c.abort();
    const e = await pending;
    expect(e).not.toBeInstanceOf(GeminiError);
    expect(e.name).toBe('AbortError');
  });

  it('an already-aborted signal rejects without fetching', async () => {
    const c = new AbortController();
    c.abort();
    const f = fakeFetch(ok('x'));
    const e = await generate({ apiKey: KEY, prompt: jsonPrompt, fetch: f, signal: c.signal }).catch(err => err);
    expect(e.name).toBe('AbortError');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('portability', () => {
  it('references no browser-only or Node-only globals', async () => {
    const src = (await ownSource('./gemini.ts')).replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/\b(window|document|localStorage|sessionStorage|process|Buffer|require)\b/);
    expect(src).not.toMatch(/key=/);
  });
});
