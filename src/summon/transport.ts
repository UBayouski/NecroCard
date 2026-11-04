// How Summon, Explain and Fix requests reach Gemini: through the NecroCard server or directly (summon REQ-4.1).
import type { SummonRequest } from './contract.js';
import type { GeminiErrorKind } from './gemini.js';

export interface Remaining {
  day: number;
  ip: number;
}

export interface TransportReply {
  text: string;
  /** The server's remaining counts; undefined on the direct path. */
  remaining?: Remaining;
}

export type TransportErrorKind = GeminiErrorKind | 'cap' | 'bad_request' | 'not_configured' | 'forbidden';

export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
    /** Remaining counts sent with the error (for `cap`), if any. */
    readonly remaining?: Remaining,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export interface Transport {
  readonly path: 'server' | 'direct';
  send(request: SummonRequest, signal?: AbortSignal): Promise<TransportReply>;
}
