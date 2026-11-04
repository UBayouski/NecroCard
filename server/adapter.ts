// Helpers that adapt node:http requests to the plain handler (summon REQ-5.2, REQ-5.7).
import type { IncomingMessage } from 'node:http';
import { LIMITS } from '../src/summon/contract.js';
import type { PlainRequest } from './handler.js';

const header = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value.join(', ') : value;

/** First X-Forwarded-For entry (Render's proxy), else the socket address (summon open question 9). */
export function clientIp(headers: IncomingMessage['headers'], remoteAddress: string | undefined): string {
  const forwarded = header(headers['x-forwarded-for'])?.split(',')[0]?.trim();
  return forwarded || remoteAddress || 'unknown';
}

/** Logged IPs keep only the first half: 203.0.x.x, 2001:db8:x. */
export function maskIp(ip: string): string {
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const [a, b] = v4.split('.');
    return `${a}.${b}.x.x`;
  }
  const groups = ip.split(':').filter(Boolean);
  return ip.includes(':') && groups.length >= 2 ? `${groups[0]}:${groups[1]}:x` : 'x';
}

export function plainHeaders(headers: IncomingMessage['headers']): PlainRequest['headers'] {
  const out: PlainRequest['headers'] = {};
  for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = header(value);
  return out;
}

export interface BodySource {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** Reads the body as UTF-8, but stops keeping bytes past the limit (the rest is drained, not stored). */
export function readBody(req: BodySource, limit: number = LIMITS.bodyBytes): Promise<{ body: string; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      bytes += chunk.byteLength;
      if (bytes > limit) {
        tooLarge = true;
        body = '';
        return;
      }
      body += decoder.decode(chunk, { stream: true });
    });
    req.on('end', () => resolve({ body: tooLarge ? '' : body + decoder.decode(), tooLarge }));
    req.on('error', reject);
  });
}
