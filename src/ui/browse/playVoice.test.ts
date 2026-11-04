// @vitest-environment happy-dom
// The play voice in domHost (necrotalk-play REQ-4, §5): a fake AudioContext records scheduled oscillators so we
// can assert frequencies, tempo-derived start times, replace-in-progress, stop-before-a-future-note, and the
// gesture gate. Drives the real DomHost.play/stopSound (no override). domHost holds module-level audio state, so
// each test imports it fresh with vi.resetModules().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardStage } from './stage.js';
import { createState } from './state.js';
import { background, button, makeStack } from './testStacks.js';
import { parseNotes } from '../../interp/notes.js';

interface FakeParam {
  value: number;
  events: { type: string; time: number; value?: number }[];
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
}
interface FakeGain { gain: FakeParam; connect(n: unknown): unknown; disconnect(): void; disconnected: boolean }
interface FakeOsc {
  type: string; frequency: { value: number };
  startedAt: number | null; stoppedAt: number | null;
  connect(n: unknown): unknown; start(t?: number): void; stop(t?: number): void; onended: (() => void) | null;
}

function makeFakeAudio() {
  const oscillators: FakeOsc[] = [];
  const gains: FakeGain[] = [];
  let now = 0;
  const param = (): FakeParam => ({
    value: 0,
    events: [],
    setValueAtTime(v, t) { this.events.push({ type: 'set', time: t, value: v }); },
    linearRampToValueAtTime(v, t) { this.events.push({ type: 'ramp', time: t, value: v }); },
    cancelScheduledValues(t) { this.events.push({ type: 'cancel', time: t }); },
  });
  const ctx = {
    get currentTime() { return now; },
    destination: {},
    resume: () => Promise.resolve(),
    createOscillator(): FakeOsc {
      const osc: FakeOsc = {
        type: 'sine', frequency: { value: 0 }, startedAt: null, stoppedAt: null, onended: null,
        connect: (n: unknown) => n, start(t = now) { this.startedAt = t; }, stop(t = now) { this.stoppedAt = t; },
      };
      oscillators.push(osc);
      return osc;
    },
    createGain(): FakeGain {
      const gain: FakeGain = { gain: param(), connect: (n: unknown) => n, disconnect() { this.disconnected = true; }, disconnected: false };
      gains.push(gain);
      return gain;
    },
  };
  return { ctx, oscillators, gains, advance: (dt: number) => { now += dt; }, setNow: (t: number) => { now = t; } };
}

let fake: ReturnType<typeof makeFakeAudio>;
const original = globalThis.AudioContext;

/** Import a fresh domHost module (so its module-level audio/gestureBound reset), then build a host. */
async function freshHost() {
  vi.resetModules();
  const { DomHost } = await import('./domHost.js');
  const stack = makeStack({ backgrounds: [background('Main', [button('Go')])], cards: [{ name: 'One', objects: [] }] });
  const stage = new CardStage();
  document.body.replaceChildren(stage.viewport);
  return new DomHost(createState(stack), stage, async () => {}, {});
}

const fireGesture = () => { globalThis.dispatchEvent(new Event('pointerdown')); };

beforeEach(() => {
  fake = makeFakeAudio();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = function () { return fake.ctx; } as unknown;
});
afterEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = original;
});

describe('play voice', () => {
  it('schedules a square-wave oscillator per note at the parsed frequencies', async () => {
    const h = await freshHost();
    fireGesture();
    h.play(parseNotes('a4 a5'), 120); // 440, 880
    expect(fake.oscillators).toHaveLength(2);
    expect(fake.oscillators.every(o => o.type === 'square')).toBe(true);
    expect(fake.oscillators[0].frequency.value).toBeCloseTo(440, 3);
    expect(fake.oscillators[1].frequency.value).toBeCloseTo(880, 3);
  });

  it('spaces note start times by beats * 60 / tempo', async () => {
    const h = await freshHost();
    fireGesture();
    h.play(parseNotes('cq cq'), 120); // 0.5 s apart at 120 bpm
    expect(fake.oscillators[1].startedAt! - fake.oscillators[0].startedAt!).toBeCloseTo(0.5, 6);
  });

  it('a higher tempo packs notes closer', async () => {
    const h = await freshHost();
    fireGesture();
    h.play(parseNotes('cq cq'), 240); // 0.25 s apart
    expect(fake.oscillators[1].startedAt! - fake.oscillators[0].startedAt!).toBeCloseTo(0.25, 6);
  });

  it('a rest advances the offset without an oscillator', async () => {
    const h = await freshHost();
    fireGesture();
    h.play(parseNotes('cq rq cq'), 120); // second note starts 1.0 s after the first
    expect(fake.oscillators).toHaveLength(2);
    expect(fake.oscillators[1].startedAt! - fake.oscillators[0].startedAt!).toBeCloseTo(1.0, 6);
  });

  it('a new play replaces the melody in progress (cancels and disconnects the old voices)', async () => {
    const h = await freshHost();
    fireGesture();
    h.play(parseNotes('cw cw'), 120);
    const first = [...fake.gains];
    h.play(parseNotes('e'), 120);
    for (const g of first) {
      expect(g.disconnected).toBe(true);
      expect(g.gain.events.some(e => e.type === 'cancel')).toBe(true);
    }
  });

  it('stop before a future note starts silences it through the gain (REQ §5.2)', async () => {
    const h = await freshHost();
    fireGesture();
    h.play(parseNotes('cq cq cq'), 120); // notes at 0, 0.5, 1.0 s
    fake.setNow(0.25); // first started, second and third not yet
    h.stopSound();
    expect(fake.gains).toHaveLength(3);
    for (const g of fake.gains) {
      expect(g.disconnected).toBe(true);
      expect(g.gain.events.some(e => e.type === 'cancel')).toBe(true);
      expect(g.gain.events.some(e => e.type === 'set' && e.time === 0.25 && e.value === 0)).toBe(true);
    }
  });

  it('is a no-op before the first gesture (no context, no throw)', async () => {
    const h = await freshHost();
    h.play(parseNotes('c e g'), 120); // no gesture
    expect(fake.oscillators).toHaveLength(0);
    expect(() => h.stopSound()).not.toThrow();
  });

  it('is a no-op when AudioContext is unavailable', async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
    const h = await freshHost();
    fireGesture();
    expect(() => h.play(parseNotes('c'), 120)).not.toThrow();
    expect(fake.oscillators).toHaveLength(0);
  });
});
