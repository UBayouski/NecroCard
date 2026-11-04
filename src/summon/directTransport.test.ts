import { describe, expect, it, vi } from 'vitest';
import type { ScriptContext } from './agentClient.js';
import type { SummonRequest } from './contract.js';
import { createDirectTransport, KEY_STORAGE, KEY_TEST_REQUEST, NO_KEY, testDirectKey } from './directTransport.js';
import { buildPrompt } from './prompts.js';
import { TransportError } from './transport.js';

const context: ScriptContext = {
  owner: { type: 'button', name: 'Go' }, stackName: 'S', cardName: 'C', backgroundName: 'B', objectNames: [],
};
const explain: SummonRequest = { kind: 'explain', payload: { script: 'on mouseUp\n  beep\nend mouseUp', context } };
const okReply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

describe('DirectTransport', () => {
  it('stores the key under necrocard.geminiKey', () => {
    expect(KEY_STORAGE).toBe('necrocard.geminiKey');
  });

  it('reads the key on every call and sends the same prompt the server would build', async () => {
    let key: string | null = ' key-one ';
    const readKey = vi.fn(() => key);
    const f = vi.fn<typeof fetch>(async () => okReply('It beeps.'));
    const transport = createDirectTransport(readKey, { fetch: f });
    expect(transport.path).toBe('direct');
    expect(readKey).not.toHaveBeenCalled();

    expect(await transport.send(explain)).toEqual({ text: 'It beeps.' });
    key = 'key-two';
    await transport.send(explain);

    expect(readKey).toHaveBeenCalledTimes(2);
    const headers = f.mock.calls.map(c => (c[1]?.headers as Record<string, string>)['x-goog-api-key']);
    expect(headers).toEqual(['key-one', 'key-two']);
    const body = JSON.parse(f.mock.calls[0][1]?.body as string);
    const built = buildPrompt(explain);
    expect(body.systemInstruction.parts[0].text).toBe(built.systemInstruction);
    expect(body.contents[0].parts[0].text).toBe(built.text);
    expect(String(f.mock.calls[0][0])).not.toContain('key-');
  });

  it('passes the model option through', async () => {
    const f = vi.fn<typeof fetch>(async () => okReply('x'));
    await createDirectTransport(() => 'k', { fetch: f, model: 'gemini-3.8-flash' }).send(explain);
    expect(f.mock.calls[0][0]).toMatch(/gemini-3\.8-flash:generateContent$/);
  });

  it.each([null, '', '   '])('no key (%p) → not_configured without fetching', async key => {
    const f = vi.fn<typeof fetch>();
    const e = await createDirectTransport(() => key, { fetch: f }).send(explain).catch(err => err);
    expect(e).toBeInstanceOf(TransportError);
    expect(e.kind).toBe('not_configured');
    expect(e.message).toBe(NO_KEY);
    expect(f).not.toHaveBeenCalled();
  });

  it('maps Gemini errors to transport errors of the same kind', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response('{}', { status: 429 }));
    const e = await createDirectTransport(() => 'k', { fetch: f }).send(explain).catch(err => err);
    expect(e).toBeInstanceOf(TransportError);
    expect(e.kind).toBe('quota');
  });

  it('validates the request with the contract limits', async () => {
    const f = vi.fn<typeof fetch>();
    const e = await createDirectTransport(() => 'k', { fetch: f })
      .send({ kind: 'explain', payload: { script: 'x'.repeat(20001), context } })
      .catch(err => err);
    expect(e.kind).toBe('bad_request');
    expect(f).not.toHaveBeenCalled();
  });

  it('testDirectKey sends the tiny explain request with the pasted key', async () => {
    const f = vi.fn<typeof fetch>(async () => okReply('It beeps.'));
    await testDirectKey('pasted-key', undefined, { fetch: f });
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)['x-goog-api-key']).toBe('pasted-key');
    expect(JSON.parse(f.mock.calls[0][1]?.body as string).contents[0].parts[0].text).toBe(buildPrompt(KEY_TEST_REQUEST).text);
    const bad = vi.fn<typeof fetch>(async () => new Response('{}', { status: 403 }));
    await expect(testDirectKey('bad', undefined, { fetch: bad })).rejects.toMatchObject({ kind: 'auth' });
  });

  it('lets an abort through as AbortError', async () => {
    const c = new AbortController();
    c.abort();
    const e = await createDirectTransport(() => 'k', { fetch: vi.fn<typeof fetch>() }).send(explain, c.signal).catch(err => err);
    expect(e.name).toBe('AbortError');
  });
});
