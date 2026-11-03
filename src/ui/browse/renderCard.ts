import type { CardObject, Stack } from '../../model/types.js';
import { backgroundOf } from './objectOps.js';
import { createButtonEl, updateButtonEl } from './renderButton.js';
import { createFieldEl, updateFieldEl, type FieldInputHandler } from './renderField.js';
import { createImageEl, updateImageEl } from './renderImage.js';

export interface RenderHooks {
  /** Called on every input in an unlocked field so the working copy stays current. */
  onFieldInput: FieldInputHandler;
}

export interface RenderedCard {
  /** `.card-layer`, 512 × 342, absolutely positioned inside the card surface. */
  layer: HTMLDivElement;
  /** Object id → element, for per-object updates. */
  elements: Map<string, HTMLElement>;
}

export function createObjectEl(obj: CardObject, hooks: RenderHooks): HTMLElement {
  switch (obj.type) {
    case 'button': return createButtonEl(obj);
    case 'field': return createFieldEl(obj, hooks.onFieldInput);
    case 'image': return createImageEl(obj);
  }
}

/** Re-render one object in place after a property, text or visibility change. */
export function updateObjectEl(el: HTMLElement, obj: CardObject): void {
  switch (obj.type) {
    case 'button': updateButtonEl(el, obj); break;
    case 'field': updateFieldEl(el, obj); break;
    case 'image': updateImageEl(el, obj); break;
  }
}

/**
 * Render a card: its background's objects first, then the card's own objects, each in
 * array (z-) order, so the browser's hit testing gives the topmost visible object.
 */
export function renderCard(stack: Stack, index: number, hooks: RenderHooks): RenderedCard {
  const card = stack.cards[index];
  if (!card) throw new Error(`Card index ${index + 1} is out of range`);
  const bg = backgroundOf(stack, card);

  const layer = document.createElement('div');
  layer.className = 'card-layer';
  layer.dataset.cardId = card.id;
  const bgLayer = document.createElement('div');
  bgLayer.className = 'background-layer';
  const cardLayer = document.createElement('div');
  cardLayer.className = 'card-objects';
  layer.append(bgLayer, cardLayer);

  const elements = new Map<string, HTMLElement>();
  for (const [parent, objects] of [[bgLayer, bg.objects], [cardLayer, card.objects]] as const) {
    for (const obj of objects) {
      const el = createObjectEl(obj, hooks);
      elements.set(obj.id, el);
      parent.append(el);
    }
  }
  return { layer, elements };
}
