// The request handler: plain request in, plain response out (summon REQ-5.1–5.6). No sockets, so tests call it
// directly with a fake `generate`. Prompts are built only from kind and payload via src/summon/prompts.ts.
import {
  HEADER_REMAINING_DAY, HEADER_REMAINING_IP, HEALTH_PATH, parseSummonRequest, SUMMON_PATH,
  type HealthResponse, type ServerErrorKind, type SummonKind, type SummonResponse,
} from '../src/summon/contract.js';
import { GeminiError, type GeminiErrorKind } from '../src/summon/gemini.js';
import { buildPrompt, type BuiltPrompt } from '../src/summon/prompts.js';
import { createCaps, secondsToUtcMidnight, type CapCounts } from './caps.js';
import type { ServerConfig } from './config.js';

export interface PlainRequest {
  method: string;
  /** Path with an optional query string. */
  path: string;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  body: string;
  /** Set by the adapter when the body exceeded the limit; `body` is then empty. */
  bodyTooLarge?: boolean;
  ip: string;
}

export interface PlainResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** For the log line only. */
  kind?: SummonKind;
}

export interface HandlerDeps {
  config: ServerConfig;
  now: () => Date;
  generate: (prompt: BuiltPrompt) => Promise<string>;
}

export const MESSAGES = {
  forbidden: 'This origin is not allowed to use the NecroCard server.',
  notFound: 'Not found.',
  method: 'Method not allowed.',
  tooLarge: 'The request is too large.',
  badJson: 'The request body is not valid JSON.',
  notConfigured: 'Summon is not configured on this server.',
  capDay: 'The daily Summon limit is used up. Try again after 00:00 UTC, or add your own Gemini key in Settings.',
  capIp:
    "You have used today's Summon requests from this network. Try again after 00:00 UTC, or add your own Gemini key in Settings.",
  quota: 'The shared Gemini quota is used up for now. Try again later, or add your own Gemini key in Settings.',
  auth: "The server's Gemini key was rejected.",
  safety: 'Gemini declined this request. Try rewording it.',
  network: 'Gemini did not answer in time. Try again.',
  upstream: 'Gemini returned an error. Try again.',
} as const;

const GEMINI_STATUS: Record<GeminiErrorKind, number> = { quota: 503, auth: 502, safety: 422, network: 504, upstream: 502 };

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export function createHandler(deps: HandlerDeps): (req: PlainRequest) => Promise<PlainResponse> {
  const { config, now, generate } = deps;
  const caps = createCaps(config.dailyCap, config.perIpCap);

  return async req => {
    const origin = req.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin) && !sameOrigin(origin, req.headers.host)) {
      return json(403, {}, failure('forbidden', MESSAGES.forbidden));
    }
    const cors: Record<string, string> = origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Expose-Headers': `${HEADER_REMAINING_DAY}, ${HEADER_REMAINING_IP}`,
          Vary: 'Origin',
        }
      : {};
    const path = req.path.split('?')[0];
    const method = req.method.toUpperCase();

    if (path !== HEALTH_PATH && path !== SUMMON_PATH) return json(404, cors, failure('not_found', MESSAGES.notFound));
    const allow = path === HEALTH_PATH ? 'GET, OPTIONS' : 'POST, OPTIONS';

    if (method === 'OPTIONS') {
      return {
        status: 204,
        headers: {
          ...cors,
          Allow: allow,
          ...(origin
            ? {
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '600',
              }
            : {}),
        },
        body: '',
      };
    }

    if (path === HEALTH_PATH) {
      if (method !== 'GET') return json(405, { ...cors, Allow: allow }, failure('method', MESSAGES.method));
      const health: HealthResponse = {
        ok: config.apiKey !== null,
        model: config.model,
        remainingDay: caps.remaining(req.ip, now()).day,
      };
      return json(200, cors, health);
    }

    // POST /api/summon
    const counted = (counts: CapCounts) => ({
      ...cors,
      [HEADER_REMAINING_DAY]: String(counts.day),
      [HEADER_REMAINING_IP]: String(counts.ip),
    });
    if (method !== 'POST') {
      return json(405, { ...counted(caps.remaining(req.ip, now())), Allow: allow }, failure('method', MESSAGES.method));
    }
    const before = counted(caps.remaining(req.ip, now()));
    if (req.bodyTooLarge) return json(413, before, failure('too_large', MESSAGES.tooLarge));

    let value: unknown;
    try {
      value = JSON.parse(req.body);
    } catch {
      return json(400, before, failure('bad_request', MESSAGES.badJson));
    }
    const parsed = parseSummonRequest(value);
    if (!parsed.ok) {
      const shown = parsed.problems.slice(0, 10).join('; ');
      const more = parsed.problems.length > 10 ? ` (and ${parsed.problems.length - 10} more)` : '';
      return json(400, before, failure('bad_request', `Invalid request: ${shown}${more}.`));
    }
    const { request } = parsed;
    if (config.apiKey === null) {
      return { ...json(503, before, failure('not_configured', MESSAGES.notConfigured)), kind: request.kind };
    }

    const at = now();
    const consumed = caps.consume(req.ip, at);
    if (!consumed.ok) {
      const headers = { ...counted(consumed.remaining), 'Retry-After': String(secondsToUtcMidnight(at)) };
      const message = consumed.reason === 'day' ? MESSAGES.capDay : MESSAGES.capIp;
      return { ...json(429, headers, failure('cap', message)), kind: request.kind };
    }
    const after = counted(consumed.remaining);
    try {
      const text = await generate(buildPrompt(request));
      const ok: SummonResponse = { ok: true, text };
      return { ...json(200, after, ok), kind: request.kind };
    } catch (e) {
      const kind: GeminiErrorKind = e instanceof GeminiError ? e.kind : 'upstream';
      return { ...json(GEMINI_STATUS[kind], after, failure(kind, MESSAGES[kind])), kind: request.kind };
    }
  };
}

/** The app is served by this process, so the browser's own Origin matches the Host header whatever the hostname. */
function sameOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  const lower = origin.toLowerCase();
  return lower === `https://${host.toLowerCase()}` || lower === `http://${host.toLowerCase()}`;
}

function failure(kind: ServerErrorKind, message: string): SummonResponse {
  return { ok: false, error: { kind, message } };
}

function json(status: number, headers: Record<string, string>, body: unknown): PlainResponse {
  return { status, headers: { ...headers, ...JSON_HEADERS }, body: JSON.stringify(body) };
}
