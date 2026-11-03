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
