// Sends Summon requests to the NecroCard server (summon REQ-4.2). No key, no credentials.
import {
  HEADER_REMAINING_DAY, HEADER_REMAINING_IP, parseSummonRequest, SERVER_ERROR_KINDS, SUMMON_PATH,
  type ServerErrorKind, type SummonRequest,
} from './contract.js';
import { TransportError, type Remaining, type Transport, type TransportErrorKind, type TransportReply } from './transport.js';

/** Cold start (about a minute on Render's free plan) plus generation. */
export const SERVER_TIMEOUT_MS = 150_000;
export const UNREACHABLE = 'The NecroCard server is not reachable.';

/** '' stays '' (same origin, Vite proxy in dev); a bare hostname gets https://; a trailing / is dropped. */
export function normalizeApiBase(base: string | undefined): string {
  const trimmed = (base ?? '').trim();
  if (trimmed === '') return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export function remainingFrom(headers: Headers): Remaining | undefined {
  const day = Number.parseInt(headers.get(HEADER_REMAINING_DAY) ?? '', 10);
  const ip = Number.parseInt(headers.get(HEADER_REMAINING_IP) ?? '', 10);
  return Number.isFinite(day) && Number.isFinite(ip) ? { day, ip } : undefined;
}

const KIND_MAP: Record<ServerErrorKind, TransportErrorKind> = {
  bad_request: 'bad_request', not_found: 'bad_request', method: 'bad_request', too_large: 'bad_request',
  forbidden: 'forbidden', cap: 'cap', not_configured: 'not_configured',
  quota: 'quota', auth: 'auth', safety: 'safety', network: 'network', upstream: 'upstream',
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A server error body → TransportError; anything unexpected → unreachable. */
function errorFrom(body: unknown, remaining: Remaining | undefined): TransportError {
  const error = isObject(body) && body.ok === false && isObject(body.error) ? body.error : null;
  const kind = error && SERVER_ERROR_KINDS.includes(error.kind as ServerErrorKind) ? (error.kind as ServerErrorKind) : null;
  if (!error || !kind || typeof error.message !== 'string') return new TransportError('network', UNREACHABLE, remaining);
  return new TransportError(KIND_MAP[kind], error.message.slice(0, 500), remaining);
}

export interface ServerTransportOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createServerTransport(apiBase: string, options: ServerTransportOptions = {}): Transport {
  const url = `${normalizeApiBase(apiBase)}${SUMMON_PATH}`;
  return {
    path: 'server',
    async send(request: SummonRequest, signal?: AbortSignal): Promise<TransportReply> {
      const checked = parseSummonRequest(request);
      if (!checked.ok) throw new TransportError('bad_request', checked.problems.join('; '));
      if (signal?.aborted) throw new DOMException('The request was cancelled', 'AbortError');
      const fetchFn = options.fetch ?? globalThis.fetch;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs ?? SERVER_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        let response: Response | undefined;
        let body: unknown;
        try {
          response = await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            credentials: 'omit',
            signal: controller.signal,
          });
          body = await response.json().catch(() => undefined);
        } catch {
          response = undefined;
        }
        if (signal?.aborted) throw new DOMException('The request was cancelled', 'AbortError');
        if (timedOut) throw new TransportError('network', 'The NecroCard server did not answer in time.');
        if (!response) throw new TransportError('network', UNREACHABLE);
        const remaining = remainingFrom(response.headers);
        if (response.ok && isObject(body) && body.ok === true && typeof body.text === 'string') {
          return { text: body.text, remaining };
        }
        throw errorFrom(body, remaining);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
