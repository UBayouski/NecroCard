// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { readSource } from './readSource.js';
import { renderCard, updateObjectEl } from './renderCard.js';
import { background, button, field, image, makeStack } from './testStacks.js';

function sample() {
  const bgTitle = field('Banner', { text: 'shared banner' });
  const bgHome = button('Home', { style: 'transparent' });
  const bg = background('Main', [bgTitle, bgHome]);
  const go = button('Go', { style: 'roundRect', label: 'Go on' });
  const blank = button('Mute', { label: '' });
  const ghost = button('Ghost', { visible: false });
  const note = field('Note', { lockText: false, text: 'edit me', style: 'transparent' });
  const pic = image('Bat', { src: 'data:image/png;base64,iVBORw0KGgo=' });
  const asset = image('Moon', { src: 'asset-moon' });
  const stack = makeStack({
    backgrounds: [bg],
    cards: [
      { name: 'One', objects: [go, blank, ghost, note, pic, asset] },
      { name: 'Two', objects: [] },
    ],
  });
  return { stack, bgTitle, bgHome, go, blank, ghost, note, pic, asset };
}

const noHooks = { onFieldInput: () => {} };

describe('renderCard', () => {
  it('renders background objects below card objects, each in array order', () => {
    const { stack, bgTitle, bgHome, go } = sample();
    const { layer } = renderCard(stack, 0, noHooks);
    expect(layer.className).toBe('card-layer');
    const [bgLayer, cardLayer] = Array.from(layer.children);
    expect(bgLayer.className).toBe('background-layer');
    expect(cardLayer.className).toBe('card-objects');
    expect(Array.from(bgLayer.children).map(e => (e as HTMLElement).dataset.objectId))
      .toEqual([bgTitle.id, bgHome.id]);
    expect((cardLayer.children[0] as HTMLElement).dataset.objectId).toBe(go.id);
  });

  it('renders background objects on every card that uses the background', () => {
    const { stack, bgTitle } = sample();
    const two = renderCard(stack, 1, noHooks);
    expect(two.elements.get(bgTitle.id)?.textContent).toBe('shared banner');
    expect(two.layer.querySelector('.card-objects')?.children.length).toBe(0);
  });

  it('maps every object id to its element with data hooks and rect', () => {
    const { stack, go } = sample();
    const { elements } = renderCard(stack, 0, noHooks);
    expect(elements.size).toBe(8);
    const el = elements.get(go.id)!;
    expect(el.dataset.objectName).toBe('Go');
    expect(el.style.left).toBe('10px');
    expect(el.style.width).toBe('100px');
    expect(el.classList.contains('card-object')).toBe(true);
  });

  it('buttons are real <button>s with style classes and accessible names', () => {
    const { stack, go, blank, bgHome } = sample();
    const { elements } = renderCard(stack, 0, noHooks);
    const goEl = elements.get(go.id) as HTMLButtonElement;
    expect(goEl.tagName).toBe('BUTTON');
    expect(goEl.type).toBe('button');
    expect(goEl.classList.contains('button-roundrect')).toBe(true);
    expect(goEl.textContent).toBe('Go on');
    expect(goEl.hasAttribute('aria-label')).toBe(false);
    expect(elements.get(blank.id)!.getAttribute('aria-label')).toBe('Mute');
    expect(elements.get(bgHome.id)!.classList.contains('button-transparent')).toBe(true);
  });

  it('hidden objects carry the hidden attribute and browse.css forces display none', async () => {
    const { stack, ghost } = sample();
    const { elements } = renderCard(stack, 0, noHooks);
    expect(elements.get(ghost.id)!.hidden).toBe(true);
    expect(elements.get(ghost.id)!.hasAttribute('hidden')).toBe(true);
    const css = await readSource('./browse.css', import.meta.url);
    expect(css.replace(/\s+/g, ' ')).toContain(
      '.card-surface .card-object[hidden] { display: none !important; }',
    );
  });

  it('images: data URL → <img>, asset id → placeholder with accessible name', () => {
    const { stack, pic, asset } = sample();
    const { elements } = renderCard(stack, 0, noHooks);
    const img = elements.get(pic.id) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.alt).toBe('Bat');
    expect(img.draggable).toBe(false);
    const ph = elements.get(asset.id)!;
    expect(ph.tagName).toBe('DIV');
    expect(ph.getAttribute('role')).toBe('img');
    expect(ph.getAttribute('aria-label')).toBe('Moon');
    expect(ph.classList.contains('image--placeholder')).toBe(true);
  });

  it('stack text is never parsed as HTML', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const stack = makeStack({
      cards: [{ name: 'X', objects: [field('F', { text: evil }), button('B', { label: evil })] }],
    });
    const { layer } = renderCard(stack, 0, noHooks);
    expect(layer.querySelector('img')).toBeNull();
    expect(layer.querySelector('.field-text')!.textContent).toBe(evil);
    expect(layer.querySelector('.button-label')!.textContent).toBe(evil);
  });

  it('updateObjectEl re-renders label and visibility in place', () => {
    const { stack, go } = sample();
    const { elements } = renderCard(stack, 0, noHooks);
    go.label = 'Changed';
    go.visible = false;
    updateObjectEl(elements.get(go.id)!, go);
    expect(elements.get(go.id)!.textContent).toBe('Changed');
    expect(elements.get(go.id)!.hidden).toBe(true);
  });

  it('unlocked field input reaches the hook', () => {
    const { stack, note } = sample();
    const onFieldInput = vi.fn();
    const { elements } = renderCard(stack, 0, { onFieldInput });
    const ta = elements.get(note.id)!.querySelector('textarea')!;
    ta.value = 'typed';
    ta.dispatchEvent(new Event('input'));
    expect(onFieldInput).toHaveBeenCalledWith(note.id, 'typed');
  });

  it('throws for an out-of-range card', () => {
    expect(() => renderCard(sample().stack, 9, noHooks)).toThrow('Card index 10 is out of range');
  });
});
