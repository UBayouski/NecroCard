import { describe, expect, it } from 'vitest';
import { createCaps, secondsToUtcMidnight, utcDay } from './caps.js';

const at = (iso: string) => new Date(iso);

describe('createCaps', () => {
  it('counts per IP and globally, and stops at each cap', () => {
    const caps = createCaps(3, 2);
    const t = at('2026-11-03T10:00:00.000Z');
    expect(caps.remaining('a', t)).toEqual({ day: 3, ip: 2 });
    expect(caps.consume('a', t)).toEqual({ ok: true, remaining: { day: 2, ip: 1 } });
    expect(caps.consume('a', t)).toEqual({ ok: true, remaining: { day: 1, ip: 0 } });
    expect(caps.consume('a', t)).toEqual({ ok: false, remaining: { day: 1, ip: 0 }, reason: 'ip' });
    expect(caps.consume('b', t)).toEqual({ ok: true, remaining: { day: 0, ip: 1 } });
    expect(caps.consume('c', t)).toEqual({ ok: false, remaining: { day: 0, ip: 2 }, reason: 'day' });
    expect(caps.remaining('a', t)).toEqual({ day: 0, ip: 0 });
  });

  it('resets everything at 00:00 UTC, not local midnight', () => {
    const caps = createCaps(1, 1);
    expect(caps.consume('a', at('2026-11-03T23:59:59.999Z')).ok).toBe(true);
    expect(caps.consume('a', at('2026-11-03T23:59:59.999Z')).ok).toBe(false);
    expect(caps.consume('a', at('2026-11-04T00:00:00.000Z'))).toEqual({ ok: true, remaining: { day: 0, ip: 0 } });
    expect(caps.trackedIps).toBe(1);
  });

  it('a zero cap refuses everything', () => {
    expect(createCaps(0, 10).consume('a', new Date())).toMatchObject({ ok: false, reason: 'day' });
    expect(createCaps(10, 0).consume('a', new Date())).toMatchObject({ ok: false, reason: 'ip' });
  });

  it('tracks at most dailyCap IPs per day', () => {
    const caps = createCaps(5, 10);
    const t = at('2026-11-03T12:00:00.000Z');
    for (let i = 0; i < 50; i++) caps.consume(`ip${i}`, t);
    expect(caps.trackedIps).toBe(5);
  });
});

describe('helpers', () => {
  it('utcDay and secondsToUtcMidnight', () => {
    expect(utcDay(at('2026-11-03T23:30:00.000Z'))).toBe('2026-11-03');
    expect(secondsToUtcMidnight(at('2026-11-03T23:59:00.000Z'))).toBe(60);
    expect(secondsToUtcMidnight(at('2026-11-03T00:00:00.000Z'))).toBe(86400);
    expect(secondsToUtcMidnight(at('2026-11-03T23:59:59.999Z'))).toBe(1);
  });
});
