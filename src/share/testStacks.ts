// Test-only helper: a fast-check generator for fixture-shaped valid stacks, and a builder for a stack
// carrying a full-card 1-bit image data URL. Local to the sharing spec (no cross-spec test import).
import fc from 'fast-check';
import adventure from '../../fixtures/adventure.necrocard.json' with { type: 'json' };
import flashcards from '../../fixtures/flashcards.necrocard.json' with { type: 'json' };
import quiz from '../../fixtures/quiz.necrocard.json' with { type: 'json' };
import type { CardObject, ImageObject, Stack } from '../model/types.js';

export const FIXTURES = [quiz, adventure, flashcards] as unknown as Stack[];
const clone = <T>(v: T): T => structuredClone(v);

const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{8,10}$/);
const rectArb = fc
  .record({ x: fc.integer({ min: 0, max: 511 }), y: fc.integer({ min: 0, max: 341 }), w: fc.nat(512), h: fc.nat(342) })
  .map(r => ({ ...r, w: Math.min(r.w, 512 - r.x), h: Math.min(r.h, 342 - r.y) }));

const patchArb = fc.record({
  name: fc.string({ maxLength: 24 }),
  rect: rectArb,
  visible: fc.boolean(),
  text: fc.string({ maxLength: 80 }),
  style: fc.nat(2),
  flag: fc.boolean(),
});
type Patch = typeof patchArb extends fc.Arbitrary<infer T> ? T : never;

function patchObject(o: CardObject, p: Patch, id: string): CardObject {
  const base = { ...o, id, name: p.name, rect: p.rect, visible: p.visible };
  if (base.type === 'button') {
    return { ...base, style: (['rect', 'roundRect', 'transparent'] as const)[p.style], label: p.text, autoHilite: p.flag };
  }
  if (base.type === 'field') {
    return { ...base, style: (['rect', 'scrolling', 'transparent'] as const)[p.style], text: p.text, lockText: p.flag };
  }
  return base; // image: keep src and script
}

/** A fixture with fresh unique ids and varied names, text, rects and styles; scripts are left as the fixture's. */
export const fixtureShapedStack: fc.Arbitrary<Stack> = fc.constantFrom(...FIXTURES).chain(fixture => {
  const holders = [...fixture.backgrounds, ...fixture.cards];
  const objectCount = holders.reduce((n, h) => n + h.objects.length, 0);
  const ownerCount = 1 + fixture.backgrounds.length + fixture.cards.length;
  const total = ownerCount + objectCount;
  return fc
    .record({
      ids: fc.uniqueArray(idArb, { minLength: total, maxLength: total }),
      names: fc.array(fc.string({ maxLength: 24 }), { minLength: ownerCount, maxLength: ownerCount }),
      patches: fc.array(patchArb, { minLength: objectCount, maxLength: objectCount }),
    })
    .map(({ ids, names, patches }) => {
      const stack = clone(fixture);
      let id = 0, owner = 0, obj = 0;
      const bgIds = new Map<string, string>();
      stack.id = ids[id++];
      stack.name = names[owner++];
      for (const bg of stack.backgrounds) {
        bgIds.set(bg.id, ids[id]);
        bg.id = ids[id++];
        bg.name = names[owner++];
      }
      for (const card of stack.cards) {
        card.id = ids[id++];
        card.name = names[owner++];
        card.backgroundId = bgIds.get(card.backgroundId)!;
      }
      for (const holder of [...stack.backgrounds, ...stack.cards]) {
        holder.objects = holder.objects.map(o => patchObject(o, patches[obj++], ids[id++]));
      }
      return stack;
    });
});

/** A 512×342 1-bit PNG-ish data URL, long enough to force the chunked btoa path (> 8192 bytes). */
export function bigImageDataUrl(): string {
  // Not a real PNG; the codec only needs a long string in a `src`. ~90 KB of base64.
  const body = 'A'.repeat((512 * 342) / 2);
  return `data:image/png;base64,${body}`;
}

/** A minimal valid stack whose one card holds a large image object. */
export function stackWithBigImage(): Stack {
  const image: ImageObject = {
    id: 'imgBig0001', name: 'Backdrop', type: 'image',
    rect: { x: 0, y: 0, w: 512, h: 342 }, visible: true, script: '', src: bigImageDataUrl(),
  };
  return {
    id: 'stkBig0001',
    name: 'Big Image',
    backgrounds: [{ id: 'bgBig00001', name: 'Main', objects: [], script: '' }],
    cards: [{ id: 'cdBig00001', name: 'Only', backgroundId: 'bgBig00001', objects: [image], script: '' }],
    script: '',
    metadata: { created: '2026-11-03T14:00:00.000Z', modified: '2026-11-03T14:00:00.000Z', author: 'Test' },
  };
}
