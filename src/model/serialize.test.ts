import { describe, it, expect } from 'vitest';
import { serializeStack, deserializeStack } from './serialize.js';
import { ValidationError } from './validate.js';
import type { Stack } from './types.js';

// Minimal valid Stack for unit tests.
function minimalStack(): Stack {
  return {
    id: 'Ab1234567_',
    name: 'Test Stack',
    backgrounds: [
      { id: 'Bg0000001_', name: 'Default', objects: [], script: '' },
    ],
    cards: [
      {
        id: 'Cd0000001_',
        name: 'Card 1',
        backgroundId: 'Bg0000001_',
        objects: [],
        script: '',
      },
    ],
    script: '',
    metadata: {
      created: '2026-11-03T14:00:00.000Z',
      modified: '2026-11-03T14:00:00.000Z',
      author: 'Test',
    },
  };
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe('serializeStack', () => {
  it('returns a string parseable by JSON.parse', () => {
    const json = serializeStack(minimalStack());
    expect(typeof json).toBe('string');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('top-level keys are in alphabetical order', () => {
    const json = serializeStack(minimalStack());
    const keys = Object.keys(JSON.parse(json) as object);
    expect(keys).toEqual([...keys].sort());
  });

  it('nested object keys are in alphabetical order', () => {
    const stack = minimalStack();
    stack.cards[0].objects = [
      {
        id: 'Ob0000001_',
        name: 'Btn',
        type: 'button',
        rect: { x: 0, y: 0, w: 100, h: 30 },
        visible: true,
        script: '',
        style: 'rect',
        label: 'Go',
        autoHilite: false,
      },
    ];
    const parsed = JSON.parse(serializeStack(stack)) as { cards: [{ objects: [Record<string, unknown>] }] };
    const objKeys = Object.keys(parsed.cards[0].objects[0]);
    expect(objKeys).toEqual([...objKeys].sort());
  });

  it('two deep-equal stacks produce identical JSON strings', () => {
    const a = minimalStack();
    const b = minimalStack();
    expect(serializeStack(a)).toBe(serializeStack(b));
  });
});

describe('deserializeStack', () => {
  it('round-trips a valid Stack', () => {
    const stack = minimalStack();
    const restored = deserializeStack(serializeStack(stack));
    expect(restored).toEqual(stack);
  });

  it('throws SyntaxError on malformed JSON', () => {
    expect(() => deserializeStack('{bad json')).toThrow(SyntaxError);
  });

  it('throws ValidationError on valid JSON that fails schema', () => {
    const bad = JSON.stringify({ id: 'Ab1234567_', name: 42 }); // name must be string
    expect(() => deserializeStack(bad)).toThrow(ValidationError);
  });
});

// ── Property-based round-trip test ────────────────────────────────────────────

import * as fc from 'fast-check';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

// Id arbitrary: 8–10 chars from the URL-safe alphabet.
const idCharArb = fc.constantFrom(...ALPHABET.split(''));
const idArb: fc.Arbitrary<string> = fc
  .array(idCharArb, { minLength: 8, maxLength: 10 })
  .map((cs) => cs.join(''));

// Rect arbitrary: non-negative integers for w, h; any integer for x, y.
const rectArb = fc.record({
  x: fc.integer({ min: -512, max: 1024 }),
  y: fc.integer({ min: -342, max: 684 }),
  w: fc.integer({ min: 0, max: 512 }),
  h: fc.integer({ min: 0, max: 342 }),
});

// Full-Unicode strings for text fields.
// fast-check 4.x: use fc.string({ unit: 'grapheme' }) for full Unicode grapheme clusters.
const unicodeStrArb = fc.string({ unit: 'grapheme' });

// Date arbitrary: ISO 8601 strings via Date.toISOString().
// Constrain to years 1000–9999 so toISOString() always produces a 4-digit year
// matching the schema pattern (dates before year 1000 produce leading zeros or
// negative-year strings like "-000001-...").
const isoDateArb = fc
  .date({
    noInvalidDate: true,
    min: new Date('1000-01-01T00:00:00.000Z'),
    max: new Date('9999-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

// Base object fields (without id — ids come from a pool).

function buttonArb(id: string): fc.Arbitrary<Stack['cards'][number]['objects'][number]> {
  return fc.record({
    id: fc.constant(id),
    name: unicodeStrArb,
    rect: rectArb,
    visible: fc.boolean(),
    script: unicodeStrArb,
    type: fc.constant('button' as const),
    style: fc.constantFrom('rect' as const, 'roundRect' as const, 'transparent' as const),
    label: unicodeStrArb,
    autoHilite: fc.boolean(),
  });
}

function fieldArb(id: string): fc.Arbitrary<Stack['cards'][number]['objects'][number]> {
  return fc.record({
    id: fc.constant(id),
    name: unicodeStrArb,
    rect: rectArb,
    visible: fc.boolean(),
    script: unicodeStrArb,
    type: fc.constant('field' as const),
    text: unicodeStrArb,
    lockText: fc.boolean(),
    style: fc.constantFrom('rect' as const, 'scrolling' as const, 'transparent' as const),
  });
}

function imageArb(id: string): fc.Arbitrary<Stack['cards'][number]['objects'][number]> {
  return fc.record({
    id: fc.constant(id),
    name: unicodeStrArb,
    rect: rectArb,
    visible: fc.boolean(),
    script: unicodeStrArb,
    type: fc.constant('image' as const),
    src: unicodeStrArb,
  });
}

function cardObjectArb(id: string): fc.Arbitrary<Stack['cards'][number]['objects'][number]> {
  return fc.oneof(buttonArb(id), fieldArb(id), imageArb(id));
}

/**
 * Build a Stack arbitrary using a pre-allocated unique id pool.
 * Pool layout (indices):
 *   0               = stack id
 *   1..bgCount      = background ids
 *   bgCount+1..
 *     bgCount+cardCount = card ids
 *   remainder       = object ids (distributed round-robin)
 */
const stackArb: fc.Arbitrary<Stack> = fc
  .record({
    bgCount: fc.integer({ min: 1, max: 3 }),
    cardCount: fc.integer({ min: 0, max: 5 }),
    objCount: fc.integer({ min: 0, max: 10 }),
  })
  .chain(({ bgCount, cardCount, objCount }) => {
    const poolSize = 1 + bgCount + cardCount + objCount;
    return fc
      .uniqueArray(idArb, { minLength: poolSize, maxLength: poolSize })
      .chain((pool) => {
        let cursor = 0;
        const stackId = pool[cursor++];
        const bgIds = pool.slice(cursor, (cursor += bgCount));
        const cardIds = pool.slice(cursor, (cursor += cardCount));
        const objIds = pool.slice(cursor, cursor + objCount);

        const backgroundsArb = fc.record({
          bgs: fc.tuple(
            ...bgIds.map((bgId) =>
              fc.record({
                id: fc.constant(bgId),
                name: unicodeStrArb,
                objects: fc.constant([] as Stack['backgrounds'][number]['objects']),
                script: unicodeStrArb,
              }),
            ),
          ),
        });

        // Distribute object ids across cards (each card gets 0 or more)
        const cardsArb =
          cardCount === 0
            ? fc.constant([] as Stack['cards'])
            : fc.record({
                cards: fc.tuple(
                  ...cardIds.map((cardId, ci) => {
                    // Objects for this card: take every cardCount-th id from the pool
                    const myObjIds = objIds.filter((_, i) => i % cardCount === ci);
                    return fc.record({
                      id: fc.constant(cardId),
                      name: unicodeStrArb,
                      backgroundId: fc.constantFrom(...bgIds),
                      objects: fc.tuple(...myObjIds.map(cardObjectArb)).map((objs) => [...objs]),
                      script: unicodeStrArb,
                    });
                  }),
                ),
              });

        return fc.record({
          id: fc.constant(stackId),
          name: unicodeStrArb,
          script: unicodeStrArb,
          metadata: fc.record({
            created: isoDateArb,
            modified: isoDateArb,
            author: unicodeStrArb,
          }),
          backgrounds: backgroundsArb.map((b) => [...b.bgs]),
          cards: cardCount === 0
            ? fc.constant([] as Stack['cards'])
            : cardsArb.map((c) => [...(c as { cards: Stack['cards'] }).cards]),
        });
      });
  });

describe('round-trip identity (PBT)', () => {
  it('serializeStack then deserializeStack is identity for any valid Stack', () => {
    fc.assert(
      fc.property(stackArb, (stack) => {
        const json = serializeStack(stack);
        const restored = deserializeStack(json);
        expect(restored).toEqual(stack);
      }),
      { numRuns: 200 },
    );
  });
});
