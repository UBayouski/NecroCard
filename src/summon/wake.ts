// Wakes a sleeping Render service with one GET /api/health on page load (summon REQ-7.3).
// Never throws, never blocks: the result is only remembered for the Summon panel.
import { HEALTH_PATH } from './contract.js';
import { normalizeApiBase } from './serverTransport.js';

export type WakeStatus = 'idle' | 'waking' | 'awake' | 'failed';

export interface WakeState {
  readonly status: WakeStatus;
  /** From the health reply, when the server sent one. */
  readonly remainingDay: number | undefined;
  /** Starts the health request once; later calls do nothing. */
  start(): void;
  /** Resolves when the health request has settled (immediately if it never started). */
  whenSettled(): Promise<void>;
}

/** A cold start takes about a minute on Render's free plan. */
export const HEALTH_TIMEOUT_MS = 90_000;

export function createWakeState(apiBase: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): WakeState {
  let status: WakeStatus = 'idle';
  let remainingDay: number | undefined;
  let settled: Promise<void> = Promise.resolve();

  async function run(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? HEALTH_TIMEOUT_MS);
    try {
      const fetchFn = options.fetch ?? globalThis.fetch;
      const response = await fetchFn(`${normalizeApiBase(apiBase)}${HEALTH_PATH}`, {
        credentials: 'omit',
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => undefined)) as { ok?: unknown; remainingDay?: unknown } | undefined;
      if (typeof body?.remainingDay === 'number') remainingDay = body.remainingDay;
      status = response.ok && body?.ok === true ? 'awake' : 'failed';
    } catch {
      status = 'failed';
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get status() {
      return status;
    },
    get remainingDay() {
      return remainingDay;
    },
    start() {
      if (status !== 'idle') return;
      status = 'waking';
      settled = run();
    },
    whenSettled: () => settled,
  };
}
