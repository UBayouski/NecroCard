import type { CardObject, Rect } from '../../model/types.js';

/** Position an element at a logical-pixel rect (the only inline style retro-ui allows on objects). */
export function applyRect(el: HTMLElement, rect: Rect): void {
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
}

/** Attributes shared by every card object element: class, data hooks, rect, visibility. */
export function applyCommon(el: HTMLElement, obj: CardObject): void {
  el.classList.add('card-object');
  el.dataset.objectId = obj.id;
  el.dataset.objectName = obj.name;
  applyRect(el, obj.rect);
  el.hidden = !obj.visible;
}
