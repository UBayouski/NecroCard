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
