import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import adventure from '../../fixtures/adventure.necrocard.json' with { type: 'json' };
import flashcards from '../../fixtures/flashcards.necrocard.json' with { type: 'json' };
import quiz from '../../fixtures/quiz.necrocard.json' with { type: 'json' };
import { parse } from '../interp/parser.js';
import { NecroTalkError } from '../interp/errors.js';
import type { CardObject, Stack } from '../model/types.js';
import { LIMITS, type SummonRequest } from './contract.js';
import { GRAMMAR_EXAMPLES } from './grammar.js';
import { scriptsOf } from './integrity.js';
import { checkReply, MAX_SCHEMA_ERRORS, retryErrors, SummonError, summonStack, type SummonProgress } from './pipeline.js';
import { TransportError, type Transport, type TransportReply } from './transport.js';

const FIXTURES = [quiz, adventure, flashcards] as unknown as Stack[];
const clone = <T>(v: T): T => structuredClone(v);

/** A transport that replies with queued texts (or errors) and records every request. */
function fakeTransport(replies: (string | Error)[]) {
  const requests: SummonRequest[] = [];
  const transport: Transport = {
    path: 'server',
    send: async (request: SummonRequest): Promise<TransportReply> => {
      requests.push(clone(request));
      const next = replies.shift();
      if (next === undefined) throw new Error('fake transport: no reply queued');
      if (next instanceof Error) throw next;
      return { text: next, remaining: { day: 90, ip: 9 } };
    },
  };
  return { transport, requests };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const SCRIPT_POOL: string[] = [
  '',
  ...GRAMMAR_EXAMPLES.map(e => e.script),
  ...FIXTURES.flatMap(f => scriptsOf(f).map(s => s.script)),
];

const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{8,10}$/);
const rectArb = fc
  .record({ x: fc.integer({ min: 0, max: 511 }), y: fc.integer({ min: 0, max: 341 }), w: fc.nat(512), h: fc.nat(342) })
  .map(r => ({ ...r, w: Math.min(r.w, 512 - r.x), h: Math.min(r.h, 342 - r.y) }));
const objectPatchArb = fc.record({
  name: fc.string({ maxLength: 20 }),
  rect: rectArb,
  visible: fc.boolean(),
  script: fc.constantFrom(...SCRIPT_POOL),
  text: fc.string({ maxLength: 60 }),
  style: fc.nat(2),
  flag: fc.boolean(),
});
type ObjectPatch = typeof objectPatchArb extends fc.Arbitrary<infer T> ? T : never;

function patchObject(o: CardObject, p: ObjectPatch, id: string): CardObject {
  const base = { ...o, id, name: p.name, rect: p.rect, visible: p.visible, script: p.script };
  if (base.type === 'button') {
    return { ...base, style: (['rect', 'roundRect', 'transparent'] as const)[p.style], label: p.text, autoHilite: p.flag };
  }
  if (base.type === 'field') {
    return { ...base, style: (['rect', 'scrolling', 'transparent'] as const)[p.style], text: p.text, lockText: p.flag };
  }
  return base;
}

/** A fixture with fresh unique ids, and varied names, text, rects, styles and (valid) scripts. */
const fixtureShapedStack: fc.Arbitrary<Stack> = fc.constantFrom(...FIXTURES).chain(fixture => {
  const objects = [...fixture.backgrounds, ...fixture.cards].flatMap(o => o.objects);
  const ownerCount = 1 + fixture.backgrounds.length + fixture.cards.length;
  return fc
    .record({
      ids: fc.uniqueArray(idArb, { minLength: ownerCount + objects.length, maxLength: ownerCount + objects.length }),
      names: fc.array(fc.string({ maxLength: 20 }), { minLength: ownerCount, maxLength: ownerCount }),
      scripts: fc.array(fc.constantFrom(...SCRIPT_POOL), { minLength: ownerCount, maxLength: ownerCount }),
      patches: fc.array(objectPatchArb, { minLength: objects.length, maxLength: objects.length }),
    })
    .map(({ ids, names, scripts, patches }) => {
      const stack = clone(fixture);
      let id = 0, owner = 0, obj = 0;
      const bgIds = new Map<string, string>();
      stack.id = ids[id++];
      stack.name = names[owner];
      stack.script = scripts[owner++];
      for (const bg of stack.backgrounds) {
        bgIds.set(bg.id, ids[id]);
        bg.id = ids[id++];
        bg.name = names[owner];
        bg.script = scripts[owner++];
      }
      for (const card of stack.cards) {
        card.id = ids[id++];
        card.name = names[owner];
        card.script = scripts[owner++];
        card.backgroundId = bgIds.get(card.backgroundId)!;
      }
      for (const holder of [...stack.backgrounds, ...stack.cards]) {
        holder.objects = holder.objects.map(o => patchObject(o, patches[obj++], ids[id++]));
      }
      return stack;
    });
});

const BAD_LINES = ['  sort lines of x', '  do "beep"', '  go to', 'end click', '  put into', '  answer'];

/** Where the broken script lives, as a function that writes into a stack. */
function scriptSlots(stack: Stack): { get(): string; set(s: string): void }[] {
  const slots: { get(): string; set(s: string): void }[] = [{ get: () => stack.script, set: s => { stack.script = s; } }];
  for (const holder of [...stack.backgrounds, ...stack.cards]) {
    slots.push({ get: () => holder.script, set: s => { holder.script = s; } });
    for (const o of holder.objects) slots.push({ get: () => o.script, set: s => { o.script = s; } });
  }
  return slots;
}

const parseError = (script: string): NecroTalkError | null => {
  try {
    parse(script);
    return null;
  } catch (e) {
    return e instanceof NecroTalkError ? e : null;
  }
};

// ---------------------------------------------------------------------------
// Property tests (REQ-3.3)
// ---------------------------------------------------------------------------

describe('summonStack properties', () => {
  const wrapArb = fc.constantFrom(
    (s: string) => s,
    (s: string) => `\`\`\`json\n${s}\n\`\`\``,
    (s: string) => `Here is your stack:\n\n${s}\n\nHave fun!`,
  );

  it('any fixture-shaped valid stack comes back equal after exactly one request', async () => {
    await fc.assert(
      fc.asyncProperty(fixtureShapedStack, wrapArb, fc.boolean(), async (stack, wrap, pretty) => {
        const { transport, requests } = fakeTransport([wrap(JSON.stringify(stack, null, pretty ? 2 : undefined))]);
        const result = await summonStack('a stack', transport);
        expect(result).toEqual(stack);
        expect(requests).toEqual([{ kind: 'summon', payload: { prompt: 'a stack' } }]);
      }),
      { numRuns: 100 },
    );
  });

  it('one broken script → exactly one retry naming its owner and line', async () => {
    await fc.assert(
      fc.asyncProperty(
        fixtureShapedStack, fc.nat(), fc.nat(), fc.constantFrom(...BAD_LINES), fc.boolean(),
        async (valid, slotSeed, lineSeed, badLine, retryValid) => {
          const broken = clone(valid);
          const slots = scriptSlots(broken);
          const slot = slots[slotSeed % slots.length];
          const lines = slot.get() === '' ? [] : slot.get().split('\n');
          const at = lines.length === 0 ? 0 : lineSeed % lines.length;
          lines.splice(at, lines.length === 0 ? 0 : 1, badLine);
          slot.set(lines.join('\n'));
          const error = parseError(slot.get());
          fc.pre(error !== null);
          const site = scriptsOf(broken).find(s => s.script === slot.get())!;

          const second = retryValid ? JSON.stringify(valid) : JSON.stringify(broken);
          const { transport, requests } = fakeTransport([JSON.stringify(broken), second]);
          const outcome = await summonStack('a stack', transport).catch((e: unknown) => e);

          expect(requests).toHaveLength(2);
          const retry = requests[1];
          expect(retry.kind).toBe('retry');
          if (retry.kind !== 'retry') return;
          expect(retry.payload.prompt).toBe('a stack');
          expect(retry.payload.previous).toBe(JSON.stringify(broken));
          const mentions = retry.payload.errors.filter(e => e.includes(`Line ${error!.line}:`));
          expect(mentions.length).toBeGreaterThanOrEqual(1);
          expect(mentions.some(e => e.startsWith(`${site.where}: Line ${error!.line}:`))).toBe(true);
          if (retryValid) {
            expect(outcome).toEqual(valid);
          } else {
            expect(outcome).toBeInstanceOf(SummonError);
            expect((outcome as SummonError).failures).toEqual(retry.payload.errors);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

describe('summonStack examples', () => {
  const good = () => clone(FIXTURES[0]);

  it('the fixtures pass checkReply unchanged', () => {
    for (const f of FIXTURES) expect(checkReply(JSON.stringify(f))).toEqual({ stack: f });
  });

  it('a schema failure is retried and the corrected stack returned, with progress in order', async () => {
    const bad = good() as unknown as Record<string, unknown>;
    delete bad.metadata;
    bad.extra = 1;
    const { transport, requests } = fakeTransport([JSON.stringify(bad), JSON.stringify(good())]);
    const progress: SummonProgress[] = [];
    const replies: TransportReply[] = [];
    const stack = await summonStack(' a quiz ', transport, { onProgress: p => progress.push(p), onReply: r => replies.push(r) });
    expect(stack).toEqual(good());
    expect(progress).toEqual(['summoning', 'validating', 'retrying', 'validating']);
    expect(replies).toHaveLength(2);
    const retry = requests[1] as Extract<SummonRequest, { kind: 'retry' }>;
    expect(retry.payload.prompt).toBe('a quiz');
    expect(retry.payload.errors).toContain(`Schema: (root) must have required property 'metadata'`);
    expect(retry.payload.errors).toContain('Schema: (root) must NOT have additional properties ("extra")');
  });

  it('two failures → SummonError listing everything from the last attempt', async () => {
    const { transport } = fakeTransport(['not json', '[1]']);
    const e = await summonStack('x', transport).catch(err => err);
    expect(e).toBeInstanceOf(SummonError);
    expect(e.failures).toEqual(['Reply was not a JSON object']);
  });

  it('integrity failures are retried', async () => {
    const bad = good();
    bad.cards[0].backgroundId = 'zzzzzzzz';
    const { transport, requests } = fakeTransport([JSON.stringify(bad), JSON.stringify(good())]);
    await summonStack('x', transport);
    expect((requests[1] as Extract<SummonRequest, { kind: 'retry' }>).payload.errors).toEqual([
      `Card "${bad.cards[0].name}": backgroundId "zzzzzzzz" does not match any background`,
    ]);
  });

  it('a transport error is not retried', async () => {
    const { transport, requests } = fakeTransport([new TransportError('cap', 'The daily Summon limit is used up.')]);
    const e = await summonStack('x', transport).catch(err => err);
    expect(e).toBeInstanceOf(TransportError);
    expect(e.kind).toBe('cap');
    expect(requests).toHaveLength(1);
  });

  it('a transport error on the retry propagates', async () => {
    const { transport, requests } = fakeTransport(['{}', new TransportError('quota', 'Quota.')]);
    const e = await summonStack('x', transport).catch(err => err);
    expect(e.kind).toBe('quota');
    expect(requests).toHaveLength(2);
  });

  it('rejects an empty or too long description without a request', async () => {
    for (const prompt of ['  ', 'a'.repeat(LIMITS.prompt + 1)]) {
      const { transport, requests } = fakeTransport([]);
      const e = await summonStack(prompt, transport).catch(err => err);
      expect(e).toBeInstanceOf(SummonError);
      expect(requests).toHaveLength(0);
    }
  });

  it('an aborted signal stops before sending, and after a reply', async () => {
    const c = new AbortController();
    c.abort();
    const { transport, requests } = fakeTransport(['{}']);
    expect((await summonStack('x', transport, { signal: c.signal }).catch(e => e)).name).toBe('AbortError');
    expect(requests).toHaveLength(0);

    const c2 = new AbortController();
    const t2 = fakeTransport(['{}', '{}']);
    const e = await summonStack('x', t2.transport, { signal: c2.signal, onReply: () => c2.abort() }).catch(err => err);
    expect(e.name).toBe('AbortError');
    expect(t2.requests).toHaveLength(1);
  });

  it('caps schema errors, error lines, error count and the previous reply', async () => {
    const bad = good();
    for (const card of bad.cards) for (const o of card.objects) (o as unknown as Record<string, unknown>).rect = 'x';
    const result = checkReply(JSON.stringify(bad));
    expect('errors' in result && result.errors.length).toBe(MAX_SCHEMA_ERRORS + 1);

    const many = Array.from({ length: 100 }, (_, i) => `${i} ${'e'.repeat(i === 0 ? 1000 : 1)}`);
    const capped = retryErrors(many);
    expect(capped).toHaveLength(LIMITS.errors);
    expect(capped[0]).toHaveLength(LIMITS.errorLine);
    expect(capped.at(-1)).toBe(`…and ${100 - (LIMITS.errors - 1)} more`);

    const huge = `{"pad":"${'p'.repeat(LIMITS.previous)}"}`;
    const { transport, requests } = fakeTransport([huge, JSON.stringify(good())]);
    await summonStack('x', transport);
    const previous = (requests[1] as Extract<SummonRequest, { kind: 'retry' }>).payload.previous;
    expect(previous).toHaveLength(LIMITS.previous);
    expect(previous.endsWith('…')).toBe(true);
  });
});
