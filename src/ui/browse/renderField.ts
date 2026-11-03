import type { FieldObject } from '../../model/types.js';
import { applyCommon } from './objectEl.js';
import { attachScrollBar } from './scrollBar.js';

const STYLE_CLASS: Record<FieldObject['style'], string> = {
  rect: 'field-rect',
  scrolling: 'field-scrolling',
  transparent: 'field-transparent',
};

export type FieldInputHandler = (objectId: string, text: string) => void;

/**
 * Render a field (REQ-2.2). The outer element is the positioned card object; inside it is
 * either a read-only text box (locked) or a reset <textarea> (unlocked), plus a DOM scroll
 * bar for the `scrolling` style. Text is always set via textContent / value.
 */
export function createFieldEl(obj: FieldObject, onInput: FieldInputHandler): HTMLElement {
  const el = document.createElement('div');
  el.classList.add('field', STYLE_CLASS[obj.style], 'font-field');

  let content: HTMLElement;
  if (obj.lockText) {
    el.classList.add('field--locked');
    content = document.createElement('div');
    content.setAttribute('role', 'textbox');
    content.setAttribute('aria-readonly', 'true');
    content.setAttribute('aria-multiline', 'true');
  } else {
    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.addEventListener('input', () => onInput(obj.id, ta.value));
    content = ta;
  }
  content.classList.add('field-text');
  content.setAttribute('aria-label', obj.name);
  el.append(content);

  updateFieldEl(el, obj);
  if (obj.style === 'scrolling') attachScrollBar(el, content, Math.max(0, obj.rect.h - 2));
  return el;
}

/** Re-apply text and visibility. Keeps the caret at the end of a focused unlocked field. */
export function updateFieldEl(el: HTMLElement, obj: FieldObject): void {
  applyCommon(el, obj);
  const content = el.querySelector<HTMLElement>('.field-text');
  if (!content) return;
  if (content instanceof HTMLTextAreaElement) {
    if (content.value !== obj.text) {
      content.value = obj.text;
      if (content.ownerDocument.activeElement === content) {
        content.selectionStart = content.selectionEnd = obj.text.length;
      }
    }
  } else {
    content.textContent = obj.text;
  }
  content.dispatchEvent(new Event('scroll'));
}
