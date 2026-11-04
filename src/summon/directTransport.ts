// Calls Gemini from the browser with the user's own key (summon REQ-4.3). The key comes only from the injected
// reader (src/main.ts reads the browser's local storage at call time); it is never read from the URL or the stack.
import { parseSummonRequest, type SummonRequest } from './contract.js';
import { generate, GeminiError } from './gemini.js';
import { buildPrompt } from './prompts.js';
import { TransportError, type Transport, type TransportReply } from './transport.js';

/** The local storage key for the bring-your-own Gemini key. */
export const KEY_STORAGE = 'necrocard.geminiKey';
export const NO_KEY = 'No Gemini key is stored. Add one in Settings.';

export interface DirectTransportOptions {
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createDirectTransport(readKey: () => string | null, options: DirectTransportOptions = {}): Transport {
  return {
    path: 'direct',
    async send(request: SummonRequest, signal?: AbortSignal): Promise<TransportReply> {
      const checked = parseSummonRequest(request);
      if (!checked.ok) throw new TransportError('bad_request', checked.problems.join('; '));
      const apiKey = readKey()?.trim();
      if (!apiKey) throw new TransportError('not_configured', NO_KEY);
      try {
        const text = await generate({
          apiKey,
          prompt: buildPrompt(request),
          model: options.model,
          signal,
          fetch: options.fetch,
          timeoutMs: options.timeoutMs,
        });
        return { text };
      } catch (e) {
        if (e instanceof GeminiError) throw new TransportError(e.kind, e.message);
        throw e;
      }
    },
  };
}

/** The tiny request Settings sends to test a pasted key (summon REQ-8.4). */
export const KEY_TEST_REQUEST: SummonRequest = {
  kind: 'explain',
  payload: {
    script: 'on mouseUp\n  beep\nend mouseUp',
    context: {
      owner: { type: 'button', name: 'Test' },
      stackName: 'Key test',
      cardName: 'Card 1',
      backgroundName: 'Background 1',
      objectNames: [{ type: 'button', name: 'Test' }],
    },
  },
};

/** Resolves when Gemini answers with the given key; rejects with TransportError (or AbortError) otherwise. */
export async function testDirectKey(key: string, signal?: AbortSignal, options: DirectTransportOptions = {}): Promise<void> {
  await createDirectTransport(() => key, options).send(KEY_TEST_REQUEST, signal);
}
