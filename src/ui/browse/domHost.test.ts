// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DomHost, MAX_NAV_DEPTH } from './domHost.js';
import { CardStage } from './stage.js';
import { createState, type BrowseState } from './state.js';
import type { TransitionClock } from './transitions.js';
import { background, button, field, makeStack } from './testStacks.js';
import type { Stack } from '../../model/types.js';

/** A clock that runs frames on microtasks and advances 40 ms per frame. */
function fastClock(): TransitionClock & { frames: number } {
  let t = 0;
  const c = {
    frames: 0,
    now: () => t,
    requestFrame: (cb: () => void) => { c.frames++; t += 40; queueMicrotask(cb); },
    reducedMotion: () => false,
  };
  return c;
}

function sampleStack(): Stack {
  const banner = field('Banner', { text: 'shared', lockText: false });
  const home = button('Home');
  const bg = background('Main', [banner, home]);
  const other = background('Other', [field('Banner', { text: 'other bg' })]);
  return makeStack({
    name: 'Haunt',
    backgrounds: [bg, other],
    cards: [
      { name: 'One', objects: [button('Go', { label: 'Go on' }), field('Note', { text: 'n1' })] },
      { name: 'Two', objects: [field('Note', { text: 'n2' })] },
      { name: 'Three', backgroundId: other.id },
    ],
  });
}

function setup(stack = sampleStack(), onMessage?: (m: string, host: DomHost, s: BrowseState) => Promise<void> | void) {
  const state = createState(stack);
  const stage = new CardStage();
  document.body.replaceChildren(stage.viewport);
  const log: string[] = [];
  const clock = fastClock();
  let beeps = 0;
  const send = async (m: 'openCard' | 'closeCard') => {
    log.push(`${m}:${state.stack.cards[state.cardIndex].name}:${stage.surface.dataset.cardName}`);
    await onMessage?.(m, host, state);
  };
  const host: DomHost = new DomHost(state, stage, send, { clock, beep: () => { beeps++; } });
  host.mountInitialCard();
  const el = (name: string) => stage.surface.querySelector<HTMLElement>(`[data-object-name="${name}"]`);
  return { state, stage, host, log, clock, el, beeps: () => beeps };
}

describe('DomHost navigation', () => {
  it('mountInitialCard renders card 1 with no messages', () => {
    const { stage, log, el } = setup();
    expect(log).toEqual([]);
    expect(stage.surface.dataset.cardIndex).toBe('0');
    expect(stage.surface.dataset.cardName).toBe('One');
    expect(el('Go')!.textContent).toBe('Go on');
    expect(el('Banner')).not.toBeNull();
  });

  it('goToCard: closeCard on the old card, render, then openCard on the new card', async () => {
    const { host, log, stage, el } = setup();
    await host.goToCard(1);
    expect(log).toEqual(['closeCard:One:One', 'openCard:Two:Two']);
    expect(host.getCurrentCardIndex()).toBe(1);
    expect(stage.surface.dataset.cardIndex).toBe('1');
    expect(el('Note')!.textContent).toBe('n2');
    expect(el('Go')).toBeNull();
    expect(stage.surface.querySelectorAll('.card-layer').length).toBe(1);
  });

  it('going to the current card is a no-op but consumes the pending effect', async () => {
    const { host, log, state } = setup();
    await host.setVisualEffect('dissolve');
    await host.goToCard(0);
    expect(log).toEqual([]);
    expect(state.pendingEffect).toBeNull();
  });

  it('rejects out-of-range indexes', async () => {
    const { host } = setup();
    await expect(host.goToCard(3)).rejects.toThrow('Card index 4 is out of range');
    await expect(host.goToCard(-1)).rejects.toThrow('Card index 0 is out of range');
  });

  it('a pending effect runs a stepped transition and is consumed; a second effect replaces the first', async () => {
    const { host, state, clock, stage } = setup();
    await host.setVisualEffect('dissolve');
    await host.setVisualEffect('wipe left');
    expect(state.pendingEffect).toBe('wipe left');
    await host.goToCard(1);
    // 40 ms per fake frame over 333 ms: ~9 frames (time-based stepping may skip steps).
    expect(clock.frames).toBeGreaterThanOrEqual(Math.floor(333 / 40));
    expect(state.pendingEffect).toBeNull();
    expect(stage.surface.querySelectorAll('.card-layer').length).toBe(1);
    const before = clock.frames;
    await host.goToCard(2);
    expect(clock.frames).toBe(before); // no effect this time
  });

  it('allows go inside openCard but stops runaway nesting', async () => {
    // Every openCard goes to the next card: 0 → 1 → 2 → 0 → … forever.
    const { host, state } = setup(sampleStack(), async (m, h) => {
      if (m === 'openCard') await h.goToCard((h.getCurrentCardIndex() + 1) % h.getCardCount());
    });
    await expect(host.goToCard(1)).rejects.toThrow('Too many nested go commands');
    expect(state.navDepth).toBe(0);
    expect(MAX_NAV_DEPTH).toBe(16);
  });

  it('a single redirect from openCard works', async () => {
    const { host, log } = setup(sampleStack(), async (m, h) => {
      if (m === 'openCard' && h.getCurrentCardIndex() === 1) await h.goToCard(2);
    });
    await host.goToCard(1);
    expect(host.getCurrentCardIndex()).toBe(2);
    expect(log).toEqual(['closeCard:One:One', 'openCard:Two:Two', 'closeCard:Two:Two', 'openCard:Three:Three']);
  });

  it('card names and count come from the working copy', () => {
    const { host } = setup();
    expect(host.getCardCount()).toBe(3);
    expect(host.getCardNames()).toEqual(['One', 'Two', 'Three']);
  });
});

describe('DomHost objects', () => {
  it('show/hide update the model and the element', () => {
    const { host, state, el } = setup();
    host.hideObject({ type: 'button', name: 'go' });
    expect(state.stack.cards[0].objects[0].visible).toBe(false);
    expect(el('Go')!.hidden).toBe(true);
    host.showObject({ type: 'button', name: 'Go' });
    expect(el('Go')!.hidden).toBe(false);
    expect(() => host.hideObject({ type: 'card', name: 'One' })).toThrow('Cannot hide a card');
  });

  it('set/get label and visible; unknown properties throw', () => {
    const { host, el } = setup();
    host.setProperty({ type: 'button', name: 'Go' }, 'label', 'Flee');
    expect(host.getProperty({ type: 'button', name: 'Go' }, 'label')).toBe('Flee');
    expect(el('Go')!.textContent).toBe('Flee');
    host.setProperty({ type: 'field', name: 'Note' }, 'visible', 'false');
    expect(el('Note')!.hidden).toBe(true);
    expect(() => host.getProperty({ type: 'button', name: 'Go' }, 'color')).toThrow('Unknown property "color"');
    expect(() => host.getFieldText({ type: 'field', name: 'Nope' })).toThrow('No field named "Nope"');
  });

  it('field text read/write updates the element', () => {
    const { host, el } = setup();
    host.setFieldText({ type: 'field', name: 'Note' }, 'boo');
    expect(host.getFieldText({ type: 'field', name: 'note' })).toBe('boo');
    expect(el('Note')!.textContent).toBe('boo');
  });

  it('background field text set on card 1 is seen on card 2 (shared background)', async () => {
    const { host, el, state } = setup();
    host.setFieldText({ type: 'field', name: 'Banner' }, 'changed on One');
    await host.goToCard(1);
    expect(host.getFieldText({ type: 'field', name: 'Banner' })).toBe('changed on One');
    expect((el('Banner')!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('changed on One');
    // A card on a different background sees its own background's field.
    await host.goToCard(2);
    expect(host.getFieldText({ type: 'field', name: 'Banner' })).toBe('other bg');
    expect(state.stack.backgrounds[0].objects[0].type === 'field' && state.stack.backgrounds[0].objects[0].text)
      .toBe('changed on One');
  });

  it('typing in an unlocked background field updates the working copy', () => {
    const { el, state } = setup();
    const ta = el('Banner')!.querySelector('textarea')!;
    ta.value = 'typed';
    ta.dispatchEvent(new Event('input'));
    const banner = state.stack.backgrounds[0].objects[0];
    expect(banner.type === 'field' && banner.text).toBe('typed');
  });

  it('never mutates the original stack', async () => {
    const original = sampleStack();
    const snapshot = JSON.stringify(original);
    const { host } = setup(original);
    host.setFieldText({ type: 'field', name: 'Note' }, 'x');
    host.hideObject({ type: 'button', name: 'Go' });
    await host.goToCard(1);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('DomHost dialogs and built-ins', () => {
  it('answer and ask delegate to the 1-bit dialogs and make the card inert', async () => {
    const { host, stage } = setup();
    const p = host.answer('Boo', ['Yes', 'No']);
    expect(stage.cardLayer!.inert).toBe(true);
    stage.surface.querySelectorAll<HTMLButtonElement>('.dialog-button')[0].click();
    expect(await p).toBe('Yes');
    expect(stage.cardLayer!.inert).toBe(false);
    const q = host.ask('Name?', 'Mina');
    stage.surface.querySelectorAll<HTMLButtonElement>('.dialog-button')[1].click();
    expect(await q).toBe('Mina');
  });

  it('random stays in [1, n]; date and time use the HyperCard short form', () => {
    const { host } = setup();
    for (let i = 0; i < 500; i++) {
      const r = host.random(6);
      expect(Number.isInteger(r) && r >= 1 && r <= 6).toBe(true);
    }
    expect(host.getDate()).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}$/);
    expect(host.getTime()).toMatch(/^\d{1,2}:\d{2}\s(AM|PM)$/);
  });

  it('beep uses the injected sound', () => {
    const { host, beeps } = setup();
    host.beep();
    expect(beeps()).toBe(1);
  });
});
