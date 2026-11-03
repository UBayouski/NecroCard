import type { ButtonObject } from '../../model/types.js';
import { applyCommon } from './objectEl.js';

const STYLE_CLASS: Record<ButtonObject['style'], string> = {
  rect: 'button-rect',
  roundRect: 'button-roundrect',
  transparent: 'button-transparent',
};

/** Render a button as a real <button> with UA styles reset in browse.css (REQ-2.1). */
export function createButtonEl(obj: ButtonObject): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.classList.add('button', STYLE_CLASS[obj.style], 'font-ui');
  const label = document.createElement('span');
  label.className = 'button-label';
  el.append(label);
  updateButtonEl(el, obj);
  return el;
}

/** Re-apply label, visibility and accessible name after a property change. */
export function updateButtonEl(el: HTMLElement, obj: ButtonObject): void {
  applyCommon(el, obj);
  const label = el.querySelector<HTMLElement>('.button-label');
  if (label) label.textContent = obj.label;
  if (obj.label.trim() === '') el.setAttribute('aria-label', obj.name);
  else el.removeAttribute('aria-label');
}
