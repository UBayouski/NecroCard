// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditOverlay } from './overlay.js';
import { clientToLogical, dragRect, isNoop, type Drag } from './pointer.js';
import { handlePoints, HANDLES, isClamped } from './geometry.js';
import { button, field, makeStack } from '../browse/testStacks.js';
import { readSource } from '../browse/readSource.js';

function sample() {
  const shown = button('Shown', { rect: { x: 10, y: 20, w: 30, h: 10 } });
  const ghost = field('Ghost', { visible: false, rect: { x: 100, y: 100, w: 40, h: 40 } });
  const stack = makeStack({ cards: [{ name: 'One', objects: [shown, ghost] }] });
  return { card: stack.cards[0], shown, ghost };
}

describe('EditOverlay', () => {
  it('draws the selection as a dashed 1px SVG outline with 4px dashes and gaps', () => {
    const { card, shown } = sample();
    const o = new EditOverlay();
    o.render(card, shown);
    const rect = o.el.querySelector('svg rect')!;
    expect(rect.getAttribute('stroke-dasharray')).toBe('4 4');
    expect(rect.getAttribute('stroke-width')).toBe('1');
    expect(rect.getAttribute('stroke')).toBe('#000000');
    expect(rect.getAttribute('shape-rendering')).toBe('crispEdges');
    const svg = o.el.querySelector<HTMLElement>('svg')!;
    expect([svg.style.left, svg.style.top, svg.getAttribute('width'), svg.getAttribute('height')])
      .toEqual(['10px', '20px', '30', '10']);
  });

  it('places eight 4 × 4 handles centred on the corners and edge midpoints', () => {
    const { card, shown } = sample();
    const o = new EditOverlay();
    o.render(card, shown);
    const handles = Array.from(o.el.querySelectorAll<HTMLElement>('.edit-handle'));
    expect(handles.map(h => h.dataset.handle)).toEqual([...HANDLES]);
    const points = handlePoints(shown.rect);
    for (const h of handles) {
      const p = points[h.dataset.handle as keyof typeof points];
      expect([h.style.left, h.style.top, h.style.width, h.style.height])
        .toEqual([`${p.x - 2}px`, `${p.y - 2}px`, '4px', '4px']);
    }
  });

  it('outlines exactly the hidden card objects, and hides the selection when nothing is selected', () => {
    const { card, ghost } = sample();
    const o = new EditOverlay();
    o.render(card, null);
    const outlines = Array.from(o.el.querySelectorAll<HTMLElement>('.edit-hidden-outline'));
    expect(outlines.map(e => e.dataset.objectId)).toEqual([ghost.id]);
    expect(outlines[0].style.width).toBe('40px');
    expect(o.el.querySelector<HTMLElement>('.edit-selection')!.hidden).toBe(true);
  });

  it('showSelection previews a rect without a model change', () => {
    const { card, shown } = sample();
    const o = new EditOverlay();
    o.render(card, shown);
    o.showSelection({ x: 50, y: 60, w: 20, h: 20 });
    expect(o.el.querySelector<HTMLElement>('svg')!.style.left).toBe('50px');
    expect(shown.rect.x).toBe(10);
  });
});

describe('pointer', () => {
  const start = { x: 100, y: 100, w: 50, h: 30 };

  it('clientToLogical divides by the scale from the surface origin', () => {
    expect(clientToLogical({ clientX: 120, clientY: 50 }, { left: 20, top: 10 }, 2)).toEqual({ x: 50, y: 20 });
    expect(clientToLogical({ clientX: 5, clientY: 5 }, { left: 0, top: 0 }, 0)).toEqual({ x: 5, y: 5 });
  });

  it.each([0.75, 1, 2])('dragRect gives integer, clamped rects at scale %d', scale => {
    const move: Drag = { kind: 'move', id: 'x', start, startClient: { x: 0, y: 0 } };
    const resize: Drag = { kind: 'resize', id: 'x', handle: 'se', start, startClient: { x: 0, y: 0 } };
    for (const [cx, cy] of [[7.3, -2.2], [100.9, 33], [-1000, 5000]]) {
      for (const r of [dragRect(move, cx, cy, scale), dragRect(resize, cx, cy, scale)]) {
        for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
        expect(isClamped(r)).toBe(true);
      }
    }
    expect(dragRect(move, 2 * scale, 0, scale)).toEqual({ ...start, x: 102 });
  });

  it('a sub-pixel movement is a no-op', () => {
    const move: Drag = { kind: 'move', id: 'x', start, startClient: { x: 10, y: 10 } };
    expect(isNoop(start, dragRect(move, 10.4, 10.4, 1))).toBe(true);
  });
});

describe('edit.css', () => {
  it('card-surface rules use only black and white and no forbidden effects', async () => {
    const css = await readSource('./edit.css', import.meta.url);
    const start = css.indexOf('card surface (1-bit)');
    const end = css.indexOf('chrome (', start);
    const surface = css.slice(start, end === -1 ? undefined : end).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(start).toBeGreaterThan(0);
    expect(surface).not.toMatch(/gradient|box-shadow|opacity|(^|[\s;{])transition\s*:|animation\s*:/);
    const colours = surface.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
    expect(new Set(colours.map(c => c.toLowerCase()))).toEqual(new Set(['#000000']));
  });
});
