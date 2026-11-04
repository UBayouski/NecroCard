import { describe, expect, it, vi } from 'vitest';
import { createWakeState } from './wake.js';

const health = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('createWakeState', () => {
  it('starts idle and does nothing until started', async () => {
    const f = vi.fn<typeof fetch>();
    const wake = createWakeState('', { fetch: f });
    expect(wake.status).toBe('idle');
    await wake.whenSettled();
    expect(f).not.toHaveBeenCalled();
  });

  it('sends one GET /api/health and remembers the result', async () => {
    const f = vi.fn<typeof fetch>(async () => health({ ok: true, model: 'm', remainingDay: 42 }));
    const wake = createWakeState('necrocard-api.onrender.com', { fetch: f });
    wake.start();
    expect(wake.status).toBe('waking');
    wake.start();
    await wake.whenSettled();
    expect(wake.status).toBe('awake');
    expect(wake.remainingDay).toBe(42);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('https://necrocard-api.onrender.com/api/health');
    expect(f.mock.calls[0][1]?.credentials).toBe('omit');
    wake.start();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a server without a key reports failed but keeps the count', async () => {
    const wake = createWakeState('', { fetch: vi.fn<typeof fetch>(async () => health({ ok: false, remainingDay: 100 })) });
    wake.start();
    await wake.whenSettled();
    expect(wake.status).toBe('failed');
    expect(wake.remainingDay).toBe(100);
  });

  it.each([
    ['fetch throws', vi.fn<typeof fetch>(async () => { throw new TypeError('offline'); })],
    ['non-JSON 502', vi.fn<typeof fetch>(async () => new Response('<html>', { status: 502 }))],
  ])('failures are silent (%s)', async (_name, f) => {
    const wake = createWakeState('', { fetch: f });
    wake.start();
    await expect(wake.whenSettled()).resolves.toBeUndefined();
    expect(wake.status).toBe('failed');
    expect(wake.remainingDay).toBeUndefined();
  });

  it('times out as failed', async () => {
    vi.useFakeTimers();
    const hanging = vi.fn<typeof fetch>((_u, init) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const wake = createWakeState('', { fetch: hanging, timeoutMs: 100 });
    wake.start();
    await vi.advanceTimersByTimeAsync(100);
    await wake.whenSettled();
    expect(wake.status).toBe('failed');
    vi.useRealTimers();
  });
});
