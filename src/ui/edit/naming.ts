import type { CardObject, Stack } from '../../model/types.js';
import { generateId } from '../../model/id.js';
import { backgroundOf } from '../browse/objectOps.js';

/** Every id used anywhere in the stack (stack, backgrounds, cards, objects). */
export function usedIds(stack: Stack): Set<string> {
  const ids = new Set<string>([stack.id]);
  for (const bg of stack.backgrounds) {
    ids.add(bg.id);
    for (const o of bg.objects) ids.add(o.id);
  }
  for (const card of stack.cards) {
    ids.add(card.id);
    for (const o of card.objects) ids.add(o.id);
  }
  return ids;
}

/** A fresh id not used in the stack; regenerates on the (negligible) chance of a collision. */
export function uniqueId(stack: Stack, gen: () => string = generateId, taken: Set<string> = usedIds(stack)): string {
  for (let i = 0; i < 1000; i++) {
    const id = gen();
    if (!taken.has(id)) return id;
  }
  throw new Error('Could not generate a unique id');
}

const PREFIX: Record<CardObject['type'], string> = { button: 'Button', field: 'Field', image: 'Image' };

function smallestFree(prefix: string, names: Iterable<string>): string {
  const used = new Set<string>();
  for (const n of names) used.add(n.toLowerCase());
  for (let n = 1; ; n++) {
    const candidate = `${prefix} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** `Button N` / `Field N` / `Image N`: smallest N unused on the card and its background. */
export function uniqueObjectName(stack: Stack, cardIndex: number, type: CardObject['type']): string {
  const card = stack.cards[cardIndex];
  const names = [...card.objects, ...backgroundOf(stack, card).objects].map(o => o.name);
  return smallestFree(PREFIX[type], names);
}

/** `Card N`: smallest N unused by any card in the stack. */
export function uniqueCardName(stack: Stack): string {
  return smallestFree('Card', stack.cards.map(c => c.name));
}
