import type { CardObject, Stack } from '../../model/types.js';
import type { MessageContext } from '../../interp/messageQueue.js';
import { backgroundOf } from './objectOps.js';

/**
 * Context for a card-level message (openCard, closeCard, openStack, or a click on the bare
 * card): card → background → stack. No object level.
 */
export function buildCardContext(stack: Stack, cardIndex: number): MessageContext {
  const card = stack.cards[cardIndex];
  if (!card) throw new Error(`Card index ${cardIndex + 1} is out of range`);
  const bg = backgroundOf(stack, card);
  return {
    cardScript: card.script,
    card: { type: 'card', name: card.name },
    backgroundScript: bg.script,
    background: { type: 'background', name: bg.name },
    stackScript: stack.script,
    stack: { type: 'stack', name: stack.name },
  };
}

/** Find an object on the card or its background by id (ids are unambiguous, names are not). */
export function findObjectById(stack: Stack, cardIndex: number, objectId: string): CardObject | undefined {
  const card = stack.cards[cardIndex];
  if (!card) return undefined;
  return card.objects.find(o => o.id === objectId)
    ?? backgroundOf(stack, card).objects.find(o => o.id === objectId);
}

/** Context for a message sent to an object: object → card → background → stack. */
export function buildObjectContext(stack: Stack, cardIndex: number, objectId: string): MessageContext {
  const obj = findObjectById(stack, cardIndex, objectId);
  if (!obj) throw new Error(`No object with id "${objectId}" on this card`);
  return {
    ...buildCardContext(stack, cardIndex),
    objectScript: obj.script,
    object: { type: obj.type, name: obj.name },
  };
}
