import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import quiz from '../../fixtures/quiz.necrocard.json' with { type: 'json' };
import type { Stack } from '../model/types.js';
import { decodeStack, encodeStack, ShareDecodeError } from './codec.js';
import { fixtureShapedStack, stackWithBigImage } from './testStacks.js';

const QUIZ = quiz as unknown as Stack;

async function expectDecodeError(text: string): Promise<ShareDecodeError> {
  const e = await decodeStack(text).catch(err => err);
  expect(e, `decoding ${JSON.stringify(text.slice(0, 20))}`).toBeInstanceOf(ShareDecodeError);
  return e as ShareDecodeError;
}

describe('encodeStack / decodeStack', () => {
  it('round-trips the quiz fixture to a deep-equal stack', async () => {
    expect(await decodeStack(await encodeStack(QUIZ))).toEqual(QUIZ);
  });

  it('produces base64url only (no +, /, = or other characters)', async () => {
    const encoded = await encodeStack(QUIZ);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips a stack carrying a 512×342 1-bit image data URL (chunked btoa)', async () => {
    const stack = stackWithBigImage();
    const encoded = await encodeStack(stack);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeStack(encoded)).toEqual(stack);
  });

  it('round-trips any fixture-shaped valid stack (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(fixtureShapedStack, async stack => {
        expect(await decodeStack(await encodeStack(stack))).toEqual(stack);
      }),
      { numRuns: 100 },
    );
  });
});

describe('decode failures are ShareDecodeError, never a raw throw or unhandled rejection', () => {
  it('a flipped character', async () => {
    const encoded = await encodeStack(QUIZ);
    const flipped = (encoded[0] === 'A' ? 'B' : 'A') + encoded.slice(1);
    await expectDecodeError(flipped);
  });

  it('a truncated string', async () => {
    const encoded = await encodeStack(QUIZ);
    await expectDecodeError(encoded.slice(0, Math.floor(encoded.length / 2)));
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['non-base64url characters', 'not valid!!'],
    ['base64url of non-deflate bytes', 'QUJDREVG'],
  ])('%s', async (_name, text) => {
    await expectDecodeError(text);
  });

  it('valid deflate of a non-stack JSON object → the schema message', async () => {
    // Reuse the encoder on a shape that is not a stack by casting; it validates on decode only.
    const encoded = await encodeStack({ hello: 'world' } as unknown as Stack);
    const e = await expectDecodeError(encoded);
    expect(e.message).toBe('That shared link is not a valid NecroCard stack.');
  });

  it('many bad links in parallel produce no unhandled rejection', async () => {
    const handler = vi.fn();
    const onRejection = (e: PromiseRejectionEvent | unknown) => handler(e);
    // Node: process event; happy-dom/browser: window event. This test runs in node.
    const proc = (globalThis as { process?: { on(e: string, cb: (r: unknown) => void): void; off(e: string, cb: (r: unknown) => void): void } }).process;
    proc?.on('unhandledRejection', onRejection);
    await Promise.all(Array.from({ length: 20 }, (_, i) => decodeStack(`bad${i}link`).catch(() => {})));
    await new Promise(r => setTimeout(r, 10));
    proc?.off('unhandledRejection', onRejection);
    expect(handler).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
