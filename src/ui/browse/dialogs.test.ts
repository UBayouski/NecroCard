// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { showAnswer, showAsk } from './dialogs.js';

function setup() {
  const surface = document.createElement('div');
  surface.className = 'card-surface';
  const layer = document.createElement('div');
  layer.className = 'card-layer';
  surface.append(layer);
  const box = document.createElement('input');
  const before = document.createElement('button');
  document.body.append(surface, box, before);
  before.focus();
  return { surface, layer, box, before, inert: () => [layer, box] };
}

const buttons = (surface: HTMLElement) =>
  Array.from(surface.querySelectorAll<HTMLButtonElement>('.dialog-button'));

const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

afterEach(() => { document.body.replaceChildren(); });

describe('showAnswer', () => {
  it('renders a modal labelled by the prompt, one OK button by default', async () => {
    const { surface, inert } = setup();
    const p = showAnswer(surface, 'Boo!', [], { inert });
    const dialog = surface.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    expect(surface.querySelector(`#${labelId}`)!.textContent).toBe('Boo!');
    expect(buttons(surface).map(b => b.textContent)).toEqual(['OK']);
    buttons(surface)[0].click();
    expect(await p).toBe('OK');
  });

  it('resolves with the clicked button; the last button is the default and gets focus', async () => {
    const { surface, inert } = setup();
    const p = showAnswer(surface, 'Pick', ['Yes', 'No', 'Maybe'], { inert });
    const bs = buttons(surface);
    expect(bs.map(b => b.textContent)).toEqual(['Yes', 'No', 'Maybe']);
    expect(bs[2].classList.contains('button--default')).toBe(true);
    expect(document.activeElement).toBe(bs[2]);
    bs[0].click();
    expect(await p).toBe('Yes');
  });

  it('Enter picks the default; Escape is ignored', async () => {
    const { surface } = setup();
    const p = showAnswer(surface, 'Pick', ['A', 'B']);
    key(surface.querySelector('.dialog')!, 'Escape');
    expect(surface.querySelector('.dialog')).not.toBeNull();
    key(surface.querySelector('.dialog')!, 'Enter');
    expect(await p).toBe('B');
  });

  it('makes the card and message box inert, then restores them and focus', async () => {
    const { surface, layer, box, before, inert } = setup();
    const p = showAnswer(surface, 'x', ['OK'], { inert });
    expect(layer.inert).toBe(true);
    expect(box.inert).toBe(true);
    buttons(surface)[0].click();
    await p;
    expect(layer.inert).toBe(false);
    expect(box.inert).toBe(false);
    expect(surface.querySelector('.dialog-backdrop')).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('Tab cycles focus inside the dialog', async () => {
    const { surface } = setup();
    const p = showAnswer(surface, 'x', ['A', 'B']);
    const [a, b] = buttons(surface);
    key(b, 'Tab');
    expect(document.activeElement).toBe(a);
    key(a, 'Tab');
    expect(document.activeElement).toBe(b);
    b.click();
    await p;
  });

  it('prompt text is not parsed as HTML', async () => {
    const { surface } = setup();
    const p = showAnswer(surface, '<b>bold</b>', ['OK']);
    expect(surface.querySelector('.dialog-prompt b')).toBeNull();
    buttons(surface)[0].click();
    await p;
  });
});

describe('showAsk', () => {
  it('pre-fills and selects the default; OK returns the text', async () => {
    const { surface } = setup();
    const p = showAsk(surface, 'Name?', 'Vlad');
    const input = surface.querySelector<HTMLInputElement>('.dialog-input')!;
    expect(input.value).toBe('Vlad');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);
    expect(buttons(surface).map(b => b.textContent)).toEqual(['Cancel', 'OK']);
    input.value = 'Mina';
    buttons(surface)[1].click();
    expect(await p).toBe('Mina');
  });

  it('Enter returns the text', async () => {
    const { surface } = setup();
    const p = showAsk(surface, 'Name?', 'x');
    key(surface.querySelector('.dialog-input')!, 'Enter');
    expect(await p).toBe('x');
  });

  it('Cancel and Escape return empty', async () => {
    const a = setup();
    const p1 = showAsk(a.surface, 'Q', 'default');
    buttons(a.surface)[0].click();
    expect(await p1).toBe('');
    const p2 = showAsk(a.surface, 'Q', 'default');
    key(a.surface.querySelector('.dialog-input')!, 'Escape');
    expect(await p2).toBe('');
    expect(a.surface.querySelector('.dialog-backdrop')).toBeNull();
  });
});
