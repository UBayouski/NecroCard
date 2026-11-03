import type { ImageObject } from '../../model/types.js';
import { applyCommon } from './objectEl.js';

/** True when src is an inline image we can show without a network request. */
export function isDataImage(src: string): boolean {
  return src.startsWith('data:image/');
}

/**
 * Render an image (REQ-2.3): data URLs as <img>; asset ids (no asset store yet) as a
 * 50% dither placeholder with an accessible name. Never makes a network request.
 */
export function createImageEl(obj: ImageObject): HTMLElement {
  let el: HTMLElement;
  if (isDataImage(obj.src)) {
    const img = document.createElement('img');
    img.src = obj.src;
    img.alt = obj.name;
    img.draggable = false;
    el = img;
  } else {
    el = document.createElement('div');
    el.classList.add('image--placeholder');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', obj.name);
  }
  el.classList.add('image');
  updateImageEl(el, obj);
  return el;
}

export function updateImageEl(el: HTMLElement, obj: ImageObject): void {
  applyCommon(el, obj);
}
