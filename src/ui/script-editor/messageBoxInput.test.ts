// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { MessageBoxInput } from './messageBoxInput.js';
import { LineHistory } from './lineHistory.js';

afterEach(() => { document.body.replaceChildren(); });

function setup() {
  const box = new MessageBoxInput(new LineHistory());
  document.body.append(box.el);
  const key = (k: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    box.input.dispatchEvent(e);
    return e;
  };
  const type = (text: string) => {
    box.input.value = text;
    box.input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const mirror = () => box.el.querySelector('.message-box-mirror')!;
  return { box, key, type, mirror };
}

describe('MessageBoxInput', () => {
  it('keeps the accessible input and highlights its text in a hidden mirror', () => {
    const { box, type, mirror } = setup();
    expect(box.input.getAttribute('aria-label')).toBe('Message box');
    expect(mirror().getAttribute('aria-hidden')).toBe('true');
    type('go to card "Q1" -- jump');
    expect(mirror().textContent).toBe('go to card "Q1" -- jump');
    expect(Array.from(mirror().querySelectorAll('.tok-keyword')).map(s => s.textContent)).toEqual(['go', 'to', 'card']);
    expect(mirror().querySelector('.tok-string')!.textContent).toBe('"Q1"');
    expect(mirror().querySelector('.tok-comment')!.textContent).toBe('-- jump');
  });

  it('shows a placeholder hint and keeps its accessible name', () => {
    const { box } = setup();
    expect(box.input.placeholder).toBe('Type a NecroTalk command and press Enter');
    expect(box.input.getAttribute('aria-label')).toBe('Message box');
    expect(box.value).toBe('');
  });

  it('Up and Down walk the history; the caret goes to the end; the draft comes back', () => {
    const { box, key, type } = setup();
    box.submitted('beep');
    box.submitted('go next');
    type('put 1 into');
    expect(key('ArrowUp').defaultPrevented).toBe(true);
    expect(box.value).toBe('go next');
    expect(box.input.selectionStart).toBe('go next'.length);
    key('ArrowUp');
    expect(box.value).toBe('beep');
    key('ArrowUp');
    expect(box.value).toBe('beep');
    key('ArrowDown');
    key('ArrowDown');
    expect(box.value).toBe('put 1 into');
  });

  it('keeps at most 50 lines and ignores modified arrow keys', () => {
    const { box, key } = setup();
    for (let i = 0; i < 55; i++) box.submitted(`put ${i} into x`);
    expect(box.history.entries.length).toBe(50);
    expect(key('ArrowUp', { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it('disabled state reaches the input', () => {
    const { box } = setup();
    box.disabled = true;
    expect(box.input.disabled).toBe(true);
    expect(box.el.classList.contains('message-box-wrap--disabled')).toBe(true);
  });
});
