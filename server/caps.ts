// In-memory daily caps: one global counter and one per-IP counter per UTC day (summon REQ-5.4).
// They reset when the process restarts; the design explains why that is acceptable.

export interface CapCounts {
  day: number;
  ip: number;
}

export type ConsumeResult =
  | { ok: true; remaining: CapCounts }
  | { ok: false; remaining: CapCounts; reason: 'day' | 'ip' };

export interface Caps {
  remaining(ip: string, now: Date): CapCounts;
  consume(ip: string, now: Date): ConsumeResult;
  /** Number of IPs tracked today (bounded by the daily cap). */
  readonly trackedIps: number;
}

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Whole seconds until the next 00:00 UTC (at least 1). */
export function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export function createCaps(dailyCap: number, perIpCap: number): Caps {
  let day = '';
  let total = 0;
  let perIp = new Map<string, number>();

  const roll = (now: Date) => {
    const today = utcDay(now);
    if (today !== day) {
      day = today;
      total = 0;
      perIp = new Map();
    }
  };
  const counts = (ip: string): CapCounts => ({
    day: Math.max(0, dailyCap - total),
    ip: Math.max(0, perIpCap - (perIp.get(ip) ?? 0)),
  });

  return {
    remaining(ip, now) {
      roll(now);
      return counts(ip);
    },
    consume(ip, now) {
      roll(now);
      const before = counts(ip);
      if (before.day === 0) return { ok: false, remaining: before, reason: 'day' };
      if (before.ip === 0) return { ok: false, remaining: before, reason: 'ip' };
      total++;
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      return { ok: true, remaining: counts(ip) };
    },
    get trackedIps() {
      return perIp.size;
    },
  };
}
