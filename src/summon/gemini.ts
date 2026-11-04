// Fetch-only client for Gemini generateContent (summon REQ-2). Runs unchanged in the browser and in Node 22:
// it uses only fetch, AbortController, JSON and URL. The key goes in the x-goog-api-key header, never the URL.
import type { BuiltPrompt } from './prompts.js';

/** Stable model, Google's named successor of gemini-2.5-flash (summon design, "Model id"). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_TIMEOUT_MS = 90_000;

const MODEL_ID = /^[a-z0-9.-]+$/;
/** Finish and block reasons that mean the content was filtered. */
const SAFETY_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

export type GeminiErrorKind = 'quota' | 'auth' | 'safety' | 'network' | 'upstream';

export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface GenerateOptions {
  apiKey: string;
  prompt: BuiltPrompt;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function isValidModelId(model: string): boolean {
  return MODEL_ID.test(model);
}

/** The URL for a model; throws for ids that could change the path. */
export function generateContentUrl(model: string): string {
  if (!isValidModelId(model)) throw new GeminiError('upstream', 'The Gemini model id is not valid.');
  return `${GEMINI_ENDPOINT}/${model}:generateContent`;
}

/** The request body: systemInstruction, contents and responseMimeType only (summon REQ-2.1). */
export function generateContentBody(prompt: BuiltPrompt): unknown {
  return {
    systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt.text }] }],
    generationConfig: { responseMimeType: prompt.json ? 'application/json' : 'text/plain' },
  };
}

const abortError = () => new DOMException('The request was cancelled', 'AbortError');

/** Calls generateContent and returns the first candidate's text, or throws GeminiError / AbortError. */
export async function generate(options: GenerateOptions): Promise<string> {
  const { apiKey, prompt, signal } = options;
  const url = generateContentUrl(options.model ?? DEFAULT_GEMINI_MODEL);
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let response: Response;
    let body: unknown;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(generateContentBody(prompt)),
        signal: controller.signal,
      });
      body = await response.json().catch(() => undefined);
    } catch {
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new GeminiError('network', 'Gemini did not answer in time.');
      throw new GeminiError('network', 'Gemini could not be reached.');
    }
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new GeminiError('network', 'Gemini did not answer in time.');
    if (!response.ok) throw errorFor(response.status, body);
    return textOf(body);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Classify an HTTP error. Google's message text is not echoed: it can quote the request. */
export function errorFor(status: number, body: unknown): GeminiError {
  const error = isObject(body) && isObject(body.error) ? body.error : {};
  const raw = JSON.stringify(error);
  if (status === 429 || error.status === 'RESOURCE_EXHAUSTED') {
    return new GeminiError('quota', `The Gemini quota is used up for now (HTTP ${status}).`, status);
  }
  if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(raw))) {
    return new GeminiError('auth', `Gemini rejected the API key (HTTP ${status}).`, status);
  }
  return new GeminiError('upstream', `Gemini returned an error (HTTP ${status}).`, status);
}

/** Extract the first candidate's text from a 2xx body. */
export function textOf(body: unknown): string {
  if (!isObject(body)) throw new GeminiError('upstream', 'Gemini returned an unreadable reply.');
  const feedback = isObject(body.promptFeedback) ? body.promptFeedback : {};
  if (typeof feedback.blockReason === 'string' && feedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
    throw new GeminiError('safety', `Gemini blocked the request (${reasonName(feedback.blockReason)}).`);
  }
  const candidate = Array.isArray(body.candidates) && isObject(body.candidates[0]) ? body.candidates[0] : null;
  if (!candidate) throw new GeminiError('upstream', 'Gemini returned no answer.');
  if (typeof candidate.finishReason === 'string' && SAFETY_REASONS.has(candidate.finishReason)) {
    throw new GeminiError('safety', `Gemini withheld the answer (${candidate.finishReason}).`);
  }
  const parts = isObject(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((p): p is Json => isObject(p) && typeof p.text === 'string' && p.thought !== true)
    .map(p => p.text as string)
    .join('');
  if (text.trim() === '') throw new GeminiError('upstream', 'Gemini returned no text.');
  return text;
}

/** Block reasons are enum names; anything else is not echoed. */
function reasonName(reason: string): string {
  return /^[A-Z_]{1,40}$/.test(reason) ? reason : 'OTHER';
}
