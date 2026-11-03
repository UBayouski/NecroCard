import type { ButtonObject, FieldObject, ImageObject, Rect } from '../../model/types.js';
import { CARD_HEIGHT, CARD_WIDTH } from '../browse/scale.js';
import { clampRect } from './geometry.js';

/** Default sizes for new objects (REQ-4.2). */
export const DEFAULT_SIZE = { button: { w: 100, h: 24 }, field: { w: 160, h: 64 } } as const;

/** A rect of the given size centred on the card, clamped to the edit-mode rules. */
export function centredRect(w: number, h: number): Rect {
  return clampRect({ x: Math.round((CARD_WIDTH - w) / 2), y: Math.round((CARD_HEIGHT - h) / 2), w, h });
}

export function defaultRect(type: 'button' | 'field'): Rect {
  const s = DEFAULT_SIZE[type];
  return centredRect(s.w, s.h);
}

export function makeButton(id: string, name: string, rect: Rect = defaultRect('button')): ButtonObject {
  return {
    id, name, type: 'button', rect: clampRect(rect), visible: true, script: '',
    style: 'roundRect', label: name, autoHilite: true,
  };
}

export function makeField(id: string, name: string, rect: Rect = defaultRect('field')): FieldObject {
  return {
    id, name, type: 'field', rect: clampRect(rect), visible: true, script: '',
    text: '', lockText: false, style: 'rect',
  };
}

export function makeImage(id: string, name: string, src: string, w: number, h: number): ImageObject {
  return { id, name, type: 'image', rect: centredRect(w, h), visible: true, script: '', src };
}
