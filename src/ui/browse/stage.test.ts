// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CardStage } from './stage.js';

describe('CardStage', () => {
  it('builds an accessible card surface with test hooks', () => {
    const stage = new CardStage();
    const s = stage.surface;
    expect(s.className).toBe('card-surface');
    expect(s.getAttribute('role')).toBe('application');
    expect(s.getAttribute('aria-label')).toBe('HyperCard stack');
    expect(s.dataset.busy).toBe('false');
    expect(s.dataset.cardIndex).toBe('0');
    expect(stage.viewport.contains(s)).toBe(true);
  });

  it('setBusy and setCard update the data attributes', () => {
    const stage = new CardStage();
    stage.setBusy(true);
    expect(stage.surface.dataset.busy).toBe('true');
    stage.setBusy(false);
    expect(stage.surface.dataset.busy).toBe('false');
    stage.setCard(3, 'Results');
    expect(stage.surface.dataset.cardIndex).toBe('3');
    expect(stage.surface.dataset.cardName).toBe('Results');
  });

  it('applyScale transforms the surface and sizes the frame', () => {
    const stage = new CardStage();
    stage.applyScale(2);
    expect(stage.surface.style.transform).toBe('scale(2)');
    const frame = stage.surface.parentElement!;
    expect(frame.style.width).toBe('1024px');
    expect(frame.style.height).toBe('684px');
  });

  it('fit falls back to 1× when the viewport has no layout', () => {
    const stage = new CardStage();
    stage.fit();
    expect(stage.currentScale).toBe(1);
  });

  describe('the HyperCard window around the card', () => {
    const layout = (stage: CardStage, w: number, h: number, titleH: number) => {
      Object.defineProperty(stage.viewport, 'clientWidth', { value: w, configurable: true });
      Object.defineProperty(stage.viewport, 'clientHeight', { value: h, configurable: true });
      const title = stage.viewport.querySelector<HTMLElement>('.card-window-title')!;
      Object.defineProperty(title, 'offsetHeight', { value: titleH, configurable: true });
      return stage.viewport.querySelector<HTMLElement>('.card-window')!;
    };

    it('puts a decorative title bar above the frame, inside one window', () => {
      const stage = new CardStage();
      const win = stage.viewport.querySelector('.card-window')!;
      expect([...win.children].map(c => c.className)).toEqual(['card-window-title', 'card-frame']);
      expect(win.querySelector('.card-window-title')!.getAttribute('aria-hidden')).toBe('true');
      expect(win.querySelector('.card-frame')!.contains(stage.surface)).toBe(true);
    });

    it('setTitle shows the stack name as text, never as HTML', () => {
      const stage = new CardStage();
      expect(stage.title).toBe('');
      stage.setTitle('The <b>Haunted</b> Quiz');
      expect(stage.title).toBe('The <b>Haunted</b> Quiz');
      expect(stage.viewport.querySelector('.card-window-title b')).toBeNull();
      stage.setTitle('');
      expect(stage.title).toBe('');
    });

    it('fit subtracts the title bar: 700px of height minus a 24px bar no longer fits two cards', () => {
      const stage = new CardStage();
      layout(stage, 2000, 700, 24);
      stage.fit();
      expect(stage.currentScale).toBe(1); // 676 / 342 < 2
      layout(stage, 2000, 700, 0);
      stage.fit();
      expect(stage.currentScale).toBe(2); // 700 / 342 >= 2, so the bar's height is what changed the answer
    });

    it('fit also subtracts the window borders', () => {
      const stage = new CardStage();
      document.body.append(stage.viewport); // computed styles exist only for attached elements, as in the app
      const win = layout(stage, 2000, 710, 24);
      // A border only has a computed width when it has a style, as in a real browser.
      win.style.cssText = 'border-top: 1px solid #000; border-bottom: 2px solid #000';
      stage.fit();
      expect(stage.currentScale).toBe(1); // 710 - 3 - 24 = 683 < 684
      win.style.cssText = '';
      stage.fit();
      expect(stage.currentScale).toBe(2); // 686 >= 684
    });
  });

  it('setCardLayer replaces the shown layer and keeps other children', () => {
    const stage = new CardStage();
    const overlay = document.createElement('div');
    stage.surface.append(overlay);
    const a = document.createElement('div');
    a.className = 'card-layer';
    const b = document.createElement('div');
    b.className = 'card-layer';
    stage.setCardLayer(a);
    expect(stage.cardLayer).toBe(a);
    stage.setCardLayer(b);
    expect(stage.cardLayer).toBe(b);
    expect(a.isConnected).toBe(false);
    expect(stage.surface.contains(overlay)).toBe(true);
  });
});

describe('CardStage edit mode hooks', () => {
  const layer = () => Object.assign(document.createElement('div'), { className: 'card-layer' });

  it('setEditing marks the surface, makes the current and every later layer inert, and back', () => {
    const stage = new CardStage();
    expect(stage.surface.dataset.mode).toBe('browse');
    const a = layer();
    stage.setCardLayer(a);
    stage.setEditing(true);
    expect(stage.surface.dataset.mode).toBe('edit');
    expect(stage.isEditing).toBe(true);
    expect(stage.surface.tabIndex).toBe(0);
    expect(a.inert).toBe(true);
    const b = layer();
    stage.setCardLayer(b);
    expect(b.inert).toBe(true);
    stage.setEditing(false);
    expect(b.inert).toBe(false);
    expect(stage.surface.hasAttribute('tabindex')).toBe(false);
    const c = layer();
    stage.setCardLayer(c);
    expect(c.inert).toBe(false);
  });

  it('setSelected sets and clears data-selected-id; leaving edit mode clears it', () => {
    const stage = new CardStage();
    stage.setEditing(true);
    stage.setSelected('abc1234567');
    expect(stage.surface.dataset.selectedId).toBe('abc1234567');
    stage.setSelected(null);
    expect('selectedId' in stage.surface.dataset).toBe(false);
    stage.setSelected('abc1234567');
    stage.setEditing(false);
    expect('selectedId' in stage.surface.dataset).toBe(false);
  });
});
