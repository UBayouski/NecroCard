// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createFieldEl, updateFieldEl } from './renderField.js';
import { LINE_PX, thumbOffset } from './scrollBar.js';
import { field } from './testStacks.js';

const noop = () => {};

describe('createFieldEl', () => {
  it('locked field: read-only text box, not focusable, named by the field name', () => {
    const el = createFieldEl(field('Question', { text: 'Boo?' }), noop);
    expect(el.classList.contains('field--locked')).toBe(true);
    expect(el.classList.contains('field-rect')).toBe(true);
    const content = el.querySelector('.field-text')!;
    expect(content.tagName).toBe('DIV');
    expect(content.getAttribute('role')).toBe('textbox');
    expect(content.getAttribute('aria-readonly')).toBe('true');
    expect(content.getAttribute('aria-label')).toBe('Question');
    expect(content.hasAttribute('tabindex')).toBe(false);
    expect(content.textContent).toBe('Boo?');
  });

  it('unlocked field: reset textarea that writes back on input', () => {
    const calls: [string, string][] = [];
    const obj = field('Name', { lockText: false, text: 'a' });
    const el = createFieldEl(obj, (id, t) => calls.push([id, t]));
    const ta = el.querySelector('textarea')!;
    expect(ta.value).toBe('a');
    expect(ta.getAttribute('aria-label')).toBe('Name');
    ta.value = 'abc';
    ta.dispatchEvent(new Event('input'));
    expect(calls).toEqual([[obj.id, 'abc']]);
  });

  it('style classes', () => {
    expect(createFieldEl(field('A', { style: 'transparent' }), noop).classList.contains('field-transparent')).toBe(true);
    const s = createFieldEl(field('B', { style: 'scrolling' }), noop);
    expect(s.classList.contains('field-scrolling')).toBe(true);
    expect(s.querySelector('.scroll-bar')).not.toBeNull();
    expect(s.querySelectorAll('.scroll-arrow').length).toBe(2);
    expect(createFieldEl(field('C'), noop).querySelector('.scroll-bar')).toBeNull();
  });

  it('updateFieldEl keeps the caret at the end of a focused unlocked field', () => {
    const obj = field('Name', { lockText: false, text: 'a' });
    const el = createFieldEl(obj, noop);
    document.body.append(el);
    const ta = el.querySelector('textarea')!;
    ta.focus();
    obj.text = 'hello';
    updateFieldEl(el, obj);
    expect(ta.value).toBe('hello');
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
    el.remove();
  });
});

describe('scroll bar', () => {
  it('thumbOffset: hidden without overflow, proportional otherwise', () => {
    expect(thumbOffset(0, 100, 100, 50)).toBeNull();
    expect(thumbOffset(0, 200, 100, 50)).toBe(0);
    expect(thumbOffset(100, 200, 100, 50)).toBe(34);
    expect(thumbOffset(50, 200, 100, 50)).toBe(17);
    expect(thumbOffset(999, 200, 100, 50)).toBe(34);
  });

  it('thumb follows scrollTop on scroll events and arrows scroll one line', () => {
    const el = createFieldEl(field('Log', { style: 'scrolling', rect: { x: 0, y: 0, w: 100, h: 82 } }), noop);
    const content = el.querySelector<HTMLElement>('.field-text')!;
    const thumb = el.querySelector<HTMLElement>('.scroll-thumb')!;
    // happy-dom has no layout: fake the overflow metrics.
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 300 });
    Object.defineProperty(content, 'clientHeight', { configurable: true, value: 80 });
    content.scrollTop = 110;
    content.dispatchEvent(new Event('scroll'));
    expect(thumb.hidden).toBe(false);
    // track = 80 - 32 = 48; room = 32; 110/220 = 0.5 → 16
    expect(thumb.style.top).toBe('16px');

    content.scrollTop = 0;
    el.querySelector<HTMLElement>('.scroll-arrow--down')!.click();
    expect(content.scrollTop).toBe(LINE_PX);
    el.querySelector<HTMLElement>('.scroll-arrow--up')!.click();
    expect(content.scrollTop).toBe(0);
  });
});
