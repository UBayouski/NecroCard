import type { Background, Card, CardObject, Stack } from '../../model/types.js';
import type { ResolvedObjectRef } from '../../interp/evaluator.js';

/** What a ResolvedObjectRef points at in the working copy of the stack. */
export type ObjectHit =
  | { kind: 'object'; obj: CardObject; layer: 'card' | 'background' }
  | { kind: 'card'; card: Card; index: number }
  | { kind: 'background'; background: Background }
  | { kind: 'stack'; stack: Stack };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The background of a card. Throws if the stack references a missing background. */
export function backgroundOf(stack: Stack, card: Card): Background {
  const bg = stack.backgrounds.find(b => b.id === card.backgroundId);
  if (!bg) throw new Error(`Card "${card.name}" has no background`);
  return bg;
}

/**
 * Resolve a reference against the current card.
 * Buttons, fields and images: card objects first (bottom to top), then background objects;
 * type must match exactly, name case-insensitively; first match wins.
 */
export function findObject(stack: Stack, cardIndex: number, ref: ResolvedObjectRef): ObjectHit {
  const card = stack.cards[cardIndex];
  switch (ref.type) {
    case 'card': {
      const index = stack.cards.findIndex(c => same(c.name, ref.name));
      if (index === -1) throw new Error(`No card named "${ref.name}"`);
      return { kind: 'card', card: stack.cards[index], index };
    }
    case 'background':
      return { kind: 'background', background: backgroundOf(stack, card) };
    case 'stack':
      return { kind: 'stack', stack };
    default: {
      const match = (o: CardObject) => o.type === ref.type && same(o.name, ref.name);
      const own = card.objects.find(match);
      if (own) return { kind: 'object', obj: own, layer: 'card' };
      const shared = backgroundOf(stack, card).objects.find(match);
      if (shared) return { kind: 'object', obj: shared, layer: 'background' };
      throw new Error(`No ${ref.type} named "${ref.name}"`);
    }
  }
}

function unknownProperty(property: string): Error {
  return new Error(`Unknown property "${property}"`);
}

/** Read a property as a string (REQ-4.7). */
export function getProp(hit: ObjectHit, property: string): string {
  if (hit.kind !== 'object') throw unknownProperty(property);
  const { obj } = hit;
  switch (property.toLowerCase()) {
    case 'visible':
      return obj.visible ? 'true' : 'false';
    case 'label':
      if (obj.type === 'button') return obj.label;
      break;
    case 'text':
      if (obj.type === 'field') return obj.text;
      break;
  }
  throw unknownProperty(property);
}

/** Parse a NecroTalk boolean string, case-insensitively. */
export function parseBoolean(value: string): boolean {
  const v = value.toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new Error(`Expected true or false but got "${value}"`);
}

/**
 * Write a property (REQ-4.7). Mutates the working copy and returns the changed object
 * so the caller can re-render it.
 */
export function setProp(hit: ObjectHit, property: string, value: string): CardObject {
  if (hit.kind !== 'object') throw unknownProperty(property);
  const { obj } = hit;
  switch (property.toLowerCase()) {
    case 'visible':
      obj.visible = parseBoolean(value);
      return obj;
    case 'label':
      if (obj.type === 'button') { obj.label = value; return obj; }
      break;
    case 'text':
      if (obj.type === 'field') { obj.text = value; return obj; }
      break;
  }
  throw unknownProperty(property);
}

/** Resolve a field for getFieldText/setFieldText; anything else is "No field named". */
export function findField(stack: Stack, cardIndex: number, ref: ResolvedObjectRef) {
  if (ref.type !== 'field') throw new Error(`No field named "${ref.name}"`);
  const hit = findObject(stack, cardIndex, ref);
  if (hit.kind !== 'object' || hit.obj.type !== 'field') throw new Error(`No field named "${ref.name}"`);
  return hit.obj;
}

/** show/hide: only buttons, fields and images can change visibility (REQ-4.6). */
export function setVisibility(
  stack: Stack, cardIndex: number, ref: ResolvedObjectRef, visible: boolean,
): CardObject {
  if (ref.type === 'card' || ref.type === 'background' || ref.type === 'stack') {
    throw new Error(`Cannot ${visible ? 'show' : 'hide'} a ${ref.type}`);
  }
  const hit = findObject(stack, cardIndex, ref);
  if (hit.kind !== 'object') throw new Error(`Cannot ${visible ? 'show' : 'hide'} a ${ref.type}`);
  hit.obj.visible = visible;
  return hit.obj;
}
