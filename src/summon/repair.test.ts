import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import quiz from '../../fixtures/quiz.necrocard.json' with { type: 'json' };
import { validateStack } from '../model/validate.js';
import { repairIds } from './repair.js';

const ID = /^[A-Za-z0-9_-]{8,10}$/;
type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Every id in a repaired stack, in document order. */
function allIds(stack: Rec): unknown[] {
  const ids: unknown[] = [stack.id];
  for (const bg of stack.backgrounds) ids.push(bg.id, ...bg.objects.map((o: Rec) => o.id));
  for (const card of stack.cards) ids.push(card.id, ...card.objects.map((o: Rec) => o.id));
  return ids;
}

/** The value with every `id` and `backgroundId` key removed, recursively. */
function withoutIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutIds);
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.entries(v).filter(([k]) => k !== 'id' && k !== 'backgroundId').map(([k, x]) => [k, withoutIds(x)]),
    );
  }
  return v;
}

// Ids as models really write them, plus junk: valid, words, padded, empty, numbers, a tiny pool to force repeats.
const idArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.stringMatching(/^[A-Za-z0-9_-]{8,10}$/),
  fc.constantFrom('stkHalloween', 'fdWord1___', 'a', '', 'bg 1', 'dup', 'dup', 'cd1Pz8kR'),
  fc.string({ maxLength: 16 }),
  fc.integer(),
  fc.constant(null),
);
const objectArb = fc.record({
  id: idArb,
  type: fc.constantFrom('button', 'field', 'image'),
  name: fc.string({ maxLength: 8 }),
});
const holderArb = fc.record({ id: idArb, name: fc.string({ maxLength: 8 }), objects: fc.array(objectArb, { maxLength: 4 }) });

/** Cards point at an id a background really has (its original id), or at nothing at all. */
const stackArb = fc
  .record({
    id: idArb,
    name: fc.string({ maxLength: 8 }),
    backgrounds: fc.array(holderArb, { minLength: 1, maxLength: 4 }),
    cardCount: fc.integer({ min: 0, max: 5 }),
    pick: fc.array(fc.nat(), { minLength: 5, maxLength: 5 }),
    cardHolders: fc.array(holderArb, { minLength: 5, maxLength: 5 }),
  })
  .map(({ cardCount, pick, cardHolders, ...rest }) => ({
    ...rest,
    cards: cardHolders.slice(0, cardCount).map((c, i) => ({
      ...c,
      backgroundId: rest.backgrounds[pick[i] % rest.backgrounds.length].id,
    })),
  }));

describe('repairIds properties', () => {
  it('after repair every id is valid and unique', () => {
    fc.assert(
      fc.property(stackArb, stack => {
        const ids = allIds(repairIds(stack) as Rec);
        for (const id of ids) expect(typeof id === 'string' && ID.test(id)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 300 },
    );
  });

  it('each backgroundId that pointed at a string background id follows that background after repair', () => {
    fc.assert(
      fc.property(stackArb, stack => {
        const out = repairIds(stack) as Rec;
        out.cards.forEach((card: Rec, i: number) => {
          const original = stack.cards[i].backgroundId;
          if (typeof original !== 'string') return; // repair only tracks string originals; others are untouched
          const first = stack.backgrounds.findIndex(b => b.id === original);
          expect(card.backgroundId).toBe(out.backgrounds[first].id);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('touches nothing but ids: with ids removed, input and output are deeply equal', () => {
    fc.assert(
      fc.property(stackArb, stack => {
        const before = structuredClone(stack);
        const out = repairIds(stack);
        expect(withoutIds(out)).toEqual(withoutIds(stack));
        expect(stack).toEqual(before); // the input itself is not mutated
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic and idempotent', () => {
    fc.assert(
      fc.property(stackArb, stack => {
        const once = repairIds(stack);
        expect(repairIds(stack)).toEqual(once);
        expect(repairIds(once)).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });
});

describe('repairIds examples', () => {
  const stack = () => structuredClone(quiz) as unknown as Rec;

  it('a stack with valid unique ids comes back equal', () => {
    expect(repairIds(stack())).toEqual(stack());
  });

  it('replaces a long id ("stkHalloween") and keeps references consistent', () => {
    const s = stack();
    const oldBg = s.backgrounds[0].id;
    s.backgrounds[0].id = 'bgHalloweenBackdrop';
    for (const c of s.cards) c.backgroundId = 'bgHalloweenBackdrop';
    s.id = 'stkHalloween';
    const out = repairIds(s) as Rec;
    expect(out.id).toMatch(ID);
    expect(out.id).toMatch(/^stk/);
    expect(out.backgrounds[0].id).toMatch(/^bg/);
    for (const c of out.cards) expect(c.backgroundId).toBe(out.backgrounds[0].id);
    expect(out.backgrounds[0].id).not.toBe(oldBg);
    expect(() => validateStack(out)).not.toThrow();
  });

  it('replaces a padded id ("fdWord1___") with a field-prefixed one', () => {
    const s = stack();
    const field = s.cards[0].objects.find((o: Rec) => o.type === 'field');
    field.id = 'fdWord1___padded';
    const short = s.cards[0].objects.find((o: Rec) => o.type === 'button');
    short.id = 'bt1';
    const out = repairIds(s) as Rec;
    const o = out.cards[0].objects;
    expect(o.find((x: Rec) => x.type === 'field').id).toMatch(/^fd[A-Za-z0-9_-]+$/);
    expect(o.find((x: Rec) => x.type === 'button').id).toMatch(/^bt/);
    expect(() => validateStack(out)).not.toThrow();
  });

  it('gives a repeated id a new value and leaves the first holder alone', () => {
    const s = stack();
    const first = s.cards[0].id as string;
    s.cards[1].id = first;
    const out = repairIds(s) as Rec;
    expect(out.cards[0].id).toBe(first);
    expect(out.cards[1].id).not.toBe(first);
    expect(out.cards[1].id).toMatch(/^cd/);
  });

  it('repairs a missing or non-string id', () => {
    const s = stack();
    delete s.cards[0].id;
    s.cards[1].id = 42;
    const out = repairIds(s) as Rec;
    expect(out.cards[0].id).toMatch(ID);
    expect(out.cards[1].id).toMatch(ID);
  });

  it('gives the same repair for the same bad id, and different ones for different bad ids', () => {
    const a = repairIds({ id: 'stkHalloween', backgrounds: [], cards: [] }) as Rec;
    const b = repairIds({ id: 'stkHalloween', backgrounds: [], cards: [] }) as Rec;
    const c = repairIds({ id: 'stkHalloweenX', backgrounds: [], cards: [] }) as Rec;
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });

  it('returns anything that is not an object, and tolerates a malformed shape, unchanged', () => {
    for (const v of [null, 1, 'x', [1, 2], undefined]) expect(repairIds(v)).toBe(v);
    expect(repairIds({ backgrounds: 'no', cards: [1, null] })).toMatchObject({ backgrounds: 'no', cards: [1, null] });
  });

  it('leaves a backgroundId that pointed nowhere alone', () => {
    const s = stack();
    s.cards[0].backgroundId = 'zzzzzzzz';
    expect((repairIds(s) as Rec).cards[0].backgroundId).toBe('zzzzzzzz');
  });
});
