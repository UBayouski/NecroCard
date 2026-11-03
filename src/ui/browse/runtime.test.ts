// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowseRuntime } from './runtime.js';
import { CardStage } from './stage.js';
import type { TransitionClock } from './transitions.js';
import { background, button, field, makeStack } from './testStacks.js';
import type { Stack } from '../../model/types.js';

const log = (s: string) => `put "${s}," after field "Log"`;
const handler = (name: string, ...lines: string[]) => `on ${name}\n${lines.map(l => `  ${l}`).join('\n')}\nend ${name}`;

function sampleStack(): Stack {
  const bgLog = field('Log', { text: '' });
  const bgButton = button('Shared', {
    script: handler('mouseUp', log('obj'), 'set the label of me to "hit"', 'pass mouseUp'),
  });
  const bg = background('Main', [bgLog, bgButton], handler('mouseUp', log('bg'), 'pass mouseUp'));
  return makeStack({
    name: 'Haunt',
    script: [
      handler('openStack', log('stack-os')),
      handler('mouseUp', log('stack')),
    ].join('\n'),
    backgrounds: [bg],
    cards: [
      {
        name: 'One',
        script: [
          handler('openStack', log('card-os'), 'pass openStack'),
          handler('openCard', log('oc1')),
          handler('closeCard', log('cc1')),
          handler('mouseUp', log('card'), 'pass mouseUp'),
        ].join('\n'),
        objects: [
          button('Press', {
            script: [
              handler('mouseDown', log('d')),
              handler('mouseUp', log('u'), 'set the label of me to "pressed"'),
            ].join('\n'),
          }),
          button('Jump', { script: [handler('mouseDown', 'go next'), handler('mouseUp', log('jump-up'))].join('\n') }),
          button('Ask', { script: handler('mouseUp', 'answer "Boo?" with "Eek"', 'put it after field "Log"') }),
          button('Bad', { script: handler('mouseUp', 'go to card "Q9"') }),
          button('Lost', { script: handler('mouseUp', 'hide field "Missing"') }),
          button('Fx', { script: handler('mouseUp', 'visual effect dissolve') }),
          button('Next', { script: handler('mouseUp', 'go next') }),
          field('Locked', { script: handler('mouseUp', log('locked')) }),
          field('Open', { lockText: false, script: handler('mouseUp', log('open')) }),
        ],
      },
      { name: 'Two', script: handler('openCard', log('oc2')) },
    ],
  });
}

function setup() {
  const stage = new CardStage();
  document.body.replaceChildren(stage.viewport);
  const messages: string[] = [];
  const status = { show: (m: string) => messages.push(m), clear: () => messages.splice(0) };
  let frames = 0;
  const clock: TransitionClock = {
    now: () => frames * 100,
    requestFrame: cb => { frames++; queueMicrotask(cb); },
    reducedMotion: () => false,
  };
  const rt = new BrowseRuntime(stage, status, { clock, beep: () => {}, nextFrame: cb => cb() });
  const el = (name: string) => stage.surface.querySelector<HTMLElement>(`[data-object-name="${name}"]`)!;
  const logText = () => {
    const f = rt.currentState!.stack.backgrounds[0].objects[0];
    return f.type === 'field' ? f.text : '';
  };
  return { stage, rt, el, messages, logText, frames: () => frames };
}

async function settle(rt: BrowseRuntime) {
  for (let i = 0; i < 200 && rt.isBusy; i++) await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
}

function pointer(type: 'pointerdown' | 'pointerup' | 'pointerover', target: Element) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }));
}

async function clickOn(rt: BrowseRuntime, target: Element) {
  pointer('pointerdown', target);
  pointer('pointerup', target);
  await settle(rt);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('BrowseRuntime load', () => {
  it('sends openStack (card, then passed to stack) and then openCard to card 1', async () => {
    const { rt, logText, stage } = setup();
    await rt.load(sampleStack());
    expect(logText()).toBe('card-os,stack-os,oc1,');
    expect(stage.surface.dataset.busy).toBe('false');
    expect(stage.surface.dataset.cardName).toBe('One');
  });
});

describe('BrowseRuntime mouse messages', () => {
  it('mouseDown then mouseUp reach the button, with me = the button', async () => {
    const { rt, el, logText } = setup();
    await rt.load(sampleStack());
    await clickOn(rt, el('Press').querySelector('.button-label')!);
    expect(logText()).toBe('card-os,stack-os,oc1,d,u,');
    expect(el('Press').textContent).toBe('pressed');
  });

  it('autoHilite inverts while pressed and over the button, and clears on release', async () => {
    const { rt, el, stage } = setup();
    await rt.load(sampleStack());
    pointer('pointerdown', el('Press'));
    expect(el('Press').classList.contains('button--hilite')).toBe(true);
    pointer('pointerover', stage.cardLayer!);
    expect(el('Press').classList.contains('button--hilite')).toBe(false);
    pointer('pointerover', el('Press'));
    expect(el('Press').classList.contains('button--hilite')).toBe(true);
    pointer('pointerup', el('Press'));
    await settle(rt);
    expect(el('Press').classList.contains('button--hilite')).toBe(false);
  });

  it('releasing elsewhere sends no mouseUp', async () => {
    const { rt, el, logText } = setup();
    await rt.load(sampleStack());
    pointer('pointerdown', el('Press'));
    pointer('pointerup', el('Next'));
    await settle(rt);
    expect(logText()).toBe('card-os,stack-os,oc1,d,');
  });

  it('mouseUp is dropped when mouseDown changed the card', async () => {
    const { rt, el, logText, stage } = setup();
    await rt.load(sampleStack());
    const jump = el('Jump');
    pointer('pointerdown', jump);
    pointer('pointerup', jump);
    await settle(rt);
    expect(stage.surface.dataset.cardName).toBe('Two');
    expect(logText()).toBe('card-os,stack-os,oc1,cc1,oc2,');
  });

  it('a click on the bare card sends mouseUp to the card (and on up the path)', async () => {
    const { rt, logText, stage } = setup();
    await rt.load(sampleStack());
    await clickOn(rt, stage.cardLayer!.querySelector('.card-objects')!);
    expect(logText()).toBe('card-os,stack-os,oc1,card,bg,stack,');
  });

  it('locked fields send messages; unlocked fields do not', async () => {
    const { rt, el, logText } = setup();
    await rt.load(sampleStack());
    await clickOn(rt, el('Open').querySelector('textarea')!);
    await clickOn(rt, el('Locked').querySelector('.field-text')!);
    expect(logText()).toBe('card-os,stack-os,oc1,locked,');
  });

  it('background button: object → card → background → stack, me = the background button', async () => {
    const { rt, el, logText } = setup();
    await rt.load(sampleStack());
    await clickOn(rt, el('Shared'));
    expect(logText()).toBe('card-os,stack-os,oc1,obj,card,bg,stack,');
    expect(el('Shared').textContent).toBe('hit');
  });

  it('keyboard activation sends mouseDown then mouseUp', async () => {
    const { rt, el, logText } = setup();
    await rt.load(sampleStack());
    el('Press').click(); // detail 0, as for Enter / Space
    await settle(rt);
    expect(logText()).toBe('card-os,stack-os,oc1,d,u,');
  });
});

describe('BrowseRuntime busy, errors, effects', () => {
  it('ignores new gestures while a dialog is open', async () => {
    const { rt, el, logText, stage } = setup();
    await rt.load(sampleStack());
    pointer('pointerdown', el('Ask'));
    pointer('pointerup', el('Ask'));
    await new Promise(r => setTimeout(r, 0));
    expect(rt.isBusy).toBe(true);
    expect(stage.surface.dataset.busy).toBe('true');
    // Ignored: busy, and the card layer is inert. Don't settle — the dialog keeps the runtime busy.
    pointer('pointerdown', el('Press'));
    pointer('pointerup', el('Press'));
    await new Promise(r => setTimeout(r, 0));
    expect(rt.isBusy).toBe(true);
    stage.surface.querySelector<HTMLButtonElement>('.dialog-button')!.click();
    await settle(rt);
    expect(logText()).toBe('card-os,stack-os,oc1,Eek');
    expect(rt.isBusy).toBe(false);
  });

  it('reports script errors with the receiver and clears busy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rt, el, messages, stage } = setup();
    await rt.load(sampleStack());
    await clickOn(rt, el('Bad'));
    expect(messages).toEqual(['Script error in button "Bad": Line 2: No card named "Q9".']);
    expect(stage.surface.dataset.busy).toBe('false');
    await clickOn(rt, el('Press'));
    expect(messages).toEqual([]); // cleared by the next successful gesture
  });

  it('host errors from DomHost carry the script line', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rt, el, messages } = setup();
    await rt.load(sampleStack());
    await clickOn(rt, el('Lost'));
    expect(messages).toEqual(['Script error in button "Lost": Line 2: No field named "Missing".']);
  });

  it('a visual effect without go does not leak into the next gesture', async () => {
    const { rt, el, frames, stage } = setup();
    await rt.load(sampleStack());
    await clickOn(rt, el('Fx'));
    expect(rt.currentState!.pendingEffect).toBeNull();
    await clickOn(rt, el('Next'));
    expect(stage.surface.dataset.cardName).toBe('Two');
    expect(frames()).toBe(0);
  });

  it('loading another stack replaces the working copy', async () => {
    const { rt, el, logText } = setup();
    await rt.load(sampleStack());
    await clickOn(rt, el('Press'));
    await rt.load(sampleStack());
    expect(logText()).toBe('card-os,stack-os,oc1,');
    expect(el('Press').textContent).toBe('Press');
  });
});

describe('BrowseRuntime edit mode hooks', () => {
  it('in edit mode no gesture or message-box line reaches a script, even with the layer not inert', async () => {
    const { rt, el, logText, stage } = setup();
    await rt.load(sampleStack());
    rt.setMode('edit');
    expect(rt.currentMode).toBe('edit');
    expect(stage.cardLayer!.inert).toBe(false); // the stage's inert is a separate guard
    await clickOn(rt, el('Press'));
    el('Press').click();
    await rt.runMessageBox('put "x" after field "Log"');
    await settle(rt);
    expect(logText()).toBe('card-os,stack-os,oc1,');
    rt.setMode('browse');
    await clickOn(rt, el('Press'));
    expect(logText()).toBe('card-os,stack-os,oc1,d,u,');
  });

  it('onLoad runs after openStack/openCard, and load resets the mode to browse', async () => {
    const stage = new CardStage();
    document.body.replaceChildren(stage.viewport);
    const events: string[] = [];
    const rt = new BrowseRuntime(stage, { show: () => {}, clear: () => {} }, {
      beep: () => {}, onLoad: () => events.push(`load:${rt.currentMode}`),
    });
    await rt.load(sampleStack());
    rt.setMode('edit');
    await rt.load(sampleStack());
    expect(events).toEqual(['load:browse', 'load:browse']);
  });
});
