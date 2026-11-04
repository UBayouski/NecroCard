// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditController } from './editor.js';
import { BrowseRuntime } from '../browse/runtime.js';
import { CardStage } from '../browse/stage.js';
import { background, button, field, makeStack } from '../browse/testStacks.js';
import { validateStack } from '../../model/validate.js';
import type { Stack } from '../../model/types.js';
import type { ImportDeps } from './imageImport.js';
import type { AgentClient } from '../../summon/agentClient.js';

const log = (s: string) => `put "${s}," after field "Log"`;
const handler = (name: string, ...lines: string[]) => `on ${name}\n${lines.map(l => `  ${l}`).join('\n')}\nend ${name}`;

function sampleStack(): Stack {
  return makeStack({
    backgrounds: [background('Main', [
      field('Log', { rect: { x: 0, y: 300, w: 512, h: 40 } }),
      button('Shared', { rect: { x: 400, y: 10, w: 100, h: 20 } }),
    ])],
    cards: [
      {
        name: 'One',
        script: [handler('mouseUp', log('card')), handler('mouseDown', log('card-down'))].join('\n'),
        objects: [
          button('Go', { rect: { x: 10, y: 10, w: 100, h: 20 }, script: handler('mouseUp', log('go')) }),
          field('Note', { rect: { x: 10, y: 100, w: 100, h: 40 }, visible: false }),
        ],
      },
      { name: 'Two', script: handler('openCard', log('open2')) },
    ],
  });
}

function setup(opts: { pickFile?: () => Promise<File | null>; importDeps?: ImportDeps; agent?: AgentClient; onChange?: () => void } = {}) {
  const stage = new CardStage();
  const inspectorHost = document.createElement('div');
  const toolbarHost = document.createElement('div');
  const messageBox = document.createElement('input');
  document.body.replaceChildren(toolbarHost, stage.viewport, inspectorHost, messageBox);
  stage.applyScale(2);
  stage.surface.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1024, bottom: 684, width: 1024, height: 684, x: 0, y: 0, toJSON: () => ({}) });
  const messages: string[] = [];
  const status = { show: (m: string) => messages.push(m), clear: () => { messages.length = 0; } };
  // eslint-disable-next-line prefer-const
  let ctrl: EditController;
  const runtime = new BrowseRuntime(stage, status, { beep: () => {}, onLoad: () => ctrl?.reset() });
  ctrl = new EditController({
    stage, runtime, status, inspectorHost, toolbarHost, messageBox,
    validate: s => { validateStack(s); }, ...opts,
  });
  const logText = () => {
    const f = runtime.currentState!.stack.backgrounds[0].objects[0];
    return f.type === 'field' ? f.text : '';
  };
  const overlay = () => stage.surface.querySelector<HTMLElement>('.edit-overlay')!;
  /** Pointer at logical (x, y) — the card is at 2× scale. */
  const at = (type: string, x: number, y: number, target: Element = overlay()) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: x * 2, clientY: y * 2, pointerId: 1 }));
  const click = (x: number, y: number) => { at('pointerdown', x, y); at('pointerup', x, y); };
  const key = (k: string, mods: KeyboardEventInit = {}, target: Element = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
  const tool = (text: string) => Array.from(toolbarHost.querySelectorAll('button')).find(b => b.textContent === text)!;
  const field_ = (label: string) => {
    const l = Array.from(inspectorHost.querySelectorAll('label')).find(x => x.textContent === label)!;
    return inspectorHost.querySelector<HTMLInputElement>(`#${l.htmlFor}`)!;
  };
  return { stage, runtime, ctrl: () => ctrl, messages, logText, at, click, key, tool, field: field_, inspectorHost, toolbarHost, messageBox };
}

async function settle(rt: BrowseRuntime) {
  for (let i = 0; i < 100 && rt.isBusy; i++) await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
}

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('EditController — onChange for autosave (sharing REQ-5.1)', () => {
  it('fires once per content change, not on a no-op or card navigation', async () => {
    const onChange = vi.fn();
    const t = setup({ onChange });
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    onChange.mockClear(); // ignore any entry churn

    t.tool('Add button').click();           // a real mutation
    expect(onChange).toHaveBeenCalledTimes(1);

    const obj = t.runtime.currentState!.stack.cards[0].objects.at(-1)!;
    t.ctrl().op(s => s.moveTo(obj.id, obj.rect, 'inspector'));
    expect(onChange).toHaveBeenCalledTimes(1); // same rect → no-op → no extra call

    t.ctrl().op(s => s.moveTo(obj.id, { x: 50, y: 50, w: 40, h: 20 }, 'inspector'));
    expect(onChange).toHaveBeenCalledTimes(2); // a change fires it

    t.ctrl().op(s => s.showCard(s.cardIndex + 1)); // card navigation: seals history, no content change
    t.ctrl().op(s => s.showCard(s.cardIndex - 1));
    expect(onChange).toHaveBeenCalledTimes(2); // still 2 — navigation does not autosave

    t.ctrl().op(s => s.undo());                    // undo is a content change
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('does not throw when onChange is not wired', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    t.tool('Add button').click();
    expect(t.runtime.currentState!.stack.cards[0].objects.length).toBeGreaterThan(2);
  });
});

describe('EditController — entering and leaving edit mode', () => {
  it('enter: card layer inert, overlay, inspector and toolbar mounted, message box disabled', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    expect(t.ctrl().enter()).toBe(true);
    expect(t.stage.surface.dataset.mode).toBe('edit');
    expect(t.stage.cardLayer!.inert).toBe(true);
    expect(t.stage.surface.querySelector('.edit-overlay')).not.toBeNull();
    expect(t.inspectorHost.querySelector('[aria-label="Inspector"]')).not.toBeNull();
    expect(t.toolbarHost.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(t.messageBox.disabled).toBe(true);
    t.ctrl().exit();
    expect(t.stage.surface.dataset.mode).toBe('browse');
    expect(t.stage.cardLayer!.inert).toBe(false);
    expect(t.stage.surface.querySelector('.edit-overlay')).toBeNull();
    expect(t.inspectorHost.children.length).toBe(0);
    expect(t.messageBox.disabled).toBe(false);
  });

  it('a click selects and sends no mouse messages; background objects are not selectable', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const go = t.runtime.currentState!.stack.cards[0].objects[0];
    t.click(20, 15);
    await settle(t.runtime);
    expect(t.stage.surface.dataset.selectedId).toBe(go.id);
    expect(t.inspectorHost.querySelector('h2')!.textContent).toBe('Button "Go"');
    t.click(450, 15); // background button "Shared"
    expect('selectedId' in t.stage.surface.dataset).toBe(false);
    t.click(300, 200); // bare card
    await settle(t.runtime);
    expect(t.logText()).toBe('');
  });

  it('hidden card objects are selectable through their outline', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    t.click(20, 110);
    expect(t.inspectorHost.querySelector('h2')!.textContent).toBe('Field "Note"');
    expect(t.stage.surface.querySelectorAll('.edit-hidden-outline').length).toBe(1);
  });
});

describe('EditController — edit background (edit-background)', () => {
  const titleBar = () => document.querySelector<HTMLElement>('.card-window-title')!;
  const striped = () => titleBar().classList.contains('card-window-title--editing-bg');

  it('Ctrl+B toggles the layer: the background button becomes selectable, the card button does not; the stripe tracks it', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    expect(striped()).toBe(false);

    t.key('b', { ctrlKey: true });
    expect(t.ctrl().session!.activeLayer).toBe('background');
    expect(striped()).toBe(true);

    t.click(450, 15); // the background button "Shared"
    expect(t.inspectorHost.querySelector('h2')!.textContent).toBe('Button "Shared"');
    t.click(20, 15); // the card button "Go" — now on the inactive layer
    expect('selectedId' in t.stage.surface.dataset).toBe(false);

    t.key('b', { ctrlKey: true });
    expect(t.ctrl().session!.activeLayer).toBe('card');
    expect(striped()).toBe(false);
    t.click(20, 15); // the card button is selectable again
    expect(t.stage.surface.dataset.selectedId).toBe(t.runtime.currentState!.stack.cards[0].objects[0].id);
  });

  it('the menu Edit Background item is checked while on, and the stripe clears on leaving Edit', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const bgItem = () => Array.from(t.toolbarHost.querySelectorAll('[role="menuitemcheckbox"]'))
      .find(b => b.textContent?.includes('Edit Background'))!;
    expect(bgItem().getAttribute('aria-checked')).toBe('false');
    t.ctrl().toggleBackground();
    expect(bgItem().getAttribute('aria-checked')).toBe('true');
    expect(striped()).toBe(true);
    t.ctrl().exit();
    expect(striped()).toBe(false);
  });

  it('a background edit is kept across cards, and a rename while on keeps the stripe', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    t.ctrl().toggleBackground();
    t.ctrl().op(s => s.addObject('button')); // lands on the background, selected
    const added = t.ctrl().session!.selected()!;
    // Visible on the other card too (shared background).
    t.ctrl().op(s => s.showCard(1));
    expect(t.runtime.currentState!.stack.cards[1].backgroundId)
      .toBe(t.runtime.currentState!.stack.cards[0].backgroundId);
    expect(t.runtime.currentState!.stack.backgrounds[0].objects.some(o => o.id === added.id)).toBe(true);
    expect(t.ctrl().session!.activeLayer).toBe('background'); // kept across navigation
    // Rename the stack while on the background layer, then simulate the title update that main.ts's onChange
    // performs (stage.setTitle). setTitle must not rebuild the title bar, so the stripe class survives.
    t.ctrl().op(s => s.renameStack('Renamed Deck'), false);
    t.stage.setTitle('Renamed Deck');
    expect(titleBar().querySelector('.card-window-title-label')!.textContent).toBe('Renamed Deck');
    expect(striped()).toBe(true);
  });
});

describe('EditController — move, resize, nudge, delete, undo', () => {
  it('a drag is one history entry with an integer rect; a plain click records nothing', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const go = t.runtime.currentState!.stack.cards[0].objects[0];
    t.click(20, 15);
    expect(t.ctrl().session!.history.size).toBe(0);
    t.at('pointerdown', 20, 15);
    t.at('pointermove', 40.3, 25.6);
    expect(go.rect).toEqual({ x: 10, y: 10, w: 100, h: 20 }); // preview only
    t.at('pointerup', 50.2, 35.7);
    expect(go.rect).toEqual({ x: 40, y: 31, w: 100, h: 20 });
    expect(t.ctrl().session!.history.size).toBe(1);
    expect(t.field('X').value).toBe('40');
  });

  it('dragging a handle resizes; Escape cancels a drag', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const go = t.runtime.currentState!.stack.cards[0].objects[0];
    t.click(20, 15);
    t.at('pointerdown', 110, 30); // se handle
    t.at('pointerup', 130, 50);
    expect(go.rect).toEqual({ x: 10, y: 10, w: 120, h: 40 });
    t.at('pointerdown', 20, 15);
    t.at('pointermove', 200, 200);
    t.key('Escape', {}, t.stage.surface);
    t.at('pointerup', 200, 200);
    expect(go.rect).toEqual({ x: 10, y: 10, w: 120, h: 40 });
    expect(t.ctrl().session!.history.size).toBe(1);
  });

  it('Arrow and Shift+Arrow nudge as one entry; Delete removes; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const card = t.runtime.currentState!.stack.cards[0];
    const go = card.objects[0];
    t.click(20, 15);
    t.key('ArrowRight');
    t.key('ArrowDown', { shiftKey: true });
    expect(go.rect).toMatchObject({ x: 11, y: 20 });
    expect(t.ctrl().session!.history.size).toBe(1);
    t.key('Delete');
    expect(card.objects.map(o => o.name)).toEqual(['Note']);
    t.key('z', { ctrlKey: true });
    expect(card.objects.map(o => o.name)).toEqual(['Go', 'Note']);
    expect(t.stage.surface.dataset.selectedId).toBe(go.id);
    // Undoing a delete re-inserts a copy (history never aliases the working copy): re-read it.
    const restored = () => card.objects.find(o => o.id === go.id)!;
    t.key('z', { ctrlKey: true });
    expect(restored().rect).toMatchObject({ x: 10, y: 10 });
    t.key('Z', { ctrlKey: true, shiftKey: true });
    expect(restored().rect).toMatchObject({ x: 11, y: 20 });
    t.key('y', { ctrlKey: true });
    expect(card.objects.map(o => o.name)).toEqual(['Note']);
    expect(t.tool('Undo').title).toBe('Undo Delete button "Go"');
  });

  it('Backspace and Ctrl+Z inside an inspector input do not touch the stack', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const card = t.runtime.currentState!.stack.cards[0];
    t.click(20, 15);
    t.key('ArrowRight');
    const name = t.field('Name');
    t.key('Backspace', {}, name);
    t.key('z', { ctrlKey: true }, name);
    expect(card.objects.length).toBe(2);
    expect(card.objects[0].rect.x).toBe(11);
  });

  it('Tab on the surface cycles selection; double-click opens the script', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const [go, note] = t.runtime.currentState!.stack.cards[0].objects;
    t.stage.surface.focus();
    t.key('Tab', {}, t.stage.surface);
    expect(t.stage.surface.dataset.selectedId).toBe(go.id);
    t.key('Tab', {}, t.stage.surface);
    expect(t.stage.surface.dataset.selectedId).toBe(note.id);
    t.key('Tab', { shiftKey: true }, t.stage.surface);
    expect(t.stage.surface.dataset.selectedId).toBe(go.id);
    t.stage.surface.querySelector('.edit-overlay')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 40, clientY: 30 }));
    expect(document.activeElement).toBe(t.field('Script'));
  });
});

describe('EditController — tools, cards and the handoff to browse mode', () => {
  it('Add button selects a new centred button; a typed script is committed by switching to Browse and runs', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    t.tool('Add button').click();
    const card = t.runtime.currentState!.stack.cards[0];
    const added = card.objects[2];
    expect(added).toMatchObject({ name: 'Button 1', rect: { x: 206, y: 159, w: 100, h: 24 } });
    t.field('Script').value = handler('mouseUp', log('new'), 'go next');
    t.ctrl().exit(); // no change event: exit must flush
    expect(added.script).toContain('go next');
    const el = t.stage.surface.querySelector(`[data-object-id="${added.id}"]`)!;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    await settle(t.runtime);
    // The new button has no mouseDown handler, so mouseDown passes to the card (card-down).
    expect(t.logText()).toBe('card-down,new,open2,');
    expect(t.stage.surface.dataset.cardName).toBe('Two');
  });

  it('card menu: new card on the same background without messages, next/prev, delete disabled at one card', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const s = t.runtime.currentState!.stack;
    const item = (text: string) => Array.from(t.toolbarHost.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(b => b.textContent === text)!;
    item('New Card').click();
    expect(s.cards.map(c => c.name)).toEqual(['One', 'Card 1', 'Two']);
    expect(t.stage.surface.dataset.cardName).toBe('Card 1');
    item('Next').click();
    expect(t.stage.surface.dataset.cardName).toBe('Two');
    expect(t.logText()).toBe(''); // openCard on Two did not run
    item('Delete Card').click();
    item('Delete Card').click();
    expect(s.cards.map(c => c.name)).toEqual(['One']);
    expect(item('Delete Card').getAttribute('aria-disabled')).toBe('true');
  });

  it('Add image imports through the injected picker and decoder', async () => {
    const file = new File([new Uint8Array(4)], 'bat.png', { type: 'image/png' });
    const importDeps: ImportDeps = {
      decode: async () => ({ width: 600, height: 300, draw: (w, h) => new Uint8ClampedArray(w * h * 4).fill(255), close: () => {} }),
    };
    const t = setup({ pickFile: async () => file, importDeps });
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    t.tool('Add image').click();
    await new Promise(r => setTimeout(r, 0));
    const img = t.runtime.currentState!.stack.cards[0].objects[2];
    expect(img).toMatchObject({ type: 'image', name: 'Image 1', rect: { w: 256, h: 128 } });
    expect(img.type === 'image' && img.src.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('a bad image file shows a status message and changes nothing', async () => {
    const t = setup({ pickFile: async () => new File(['x'], 'x.txt', { type: 'text/plain' }) });
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    t.tool('Add image').click();
    await new Promise(r => setTimeout(r, 0));
    expect(t.messages).toEqual(['Could not import image: the file is not an image']);
    expect(t.runtime.currentState!.stack.cards[0].objects.length).toBe(2);
  });

  it('loading a stack returns to Browse and clears the history', async () => {
    const t = setup();
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    t.tool('Add field').click();
    expect(t.ctrl().session!.history.size).toBe(1);
    await t.runtime.load(sampleStack());
    expect(t.ctrl().mode).toBe('browse');
    expect(t.stage.surface.dataset.mode).toBe('browse');
    t.ctrl().enter();
    expect(t.ctrl().session!.history.size).toBe(0);
    expect(t.tool('Undo').disabled).toBe(true);
  });
});

describe('EditController — script editor Fix through undo (script-editor REQ-5.4)', () => {
  it('Apply is one history entry, and Ctrl+Z outside a text control restores the previous script', async () => {
    const proposal = handler('mouseUp', log('fixed'));
    const seen: { script: string; error: string | null; owner: string }[] = [];
    const agent: AgentClient = {
      explain: async () => 'n/a',
      fix: async (script, error, context) => { seen.push({ script, error, owner: `${context.owner.type}:${context.owner.name}` }); return proposal; },
    };
    const t = setup({ agent });
    await t.runtime.load(sampleStack());
    t.ctrl().enter();
    const go = t.runtime.currentState!.stack.cards[0].objects[0];
    const original = go.script;
    t.click(20, 15);
    const before = t.ctrl().session!.history.size;
    Array.from(t.inspectorHost.querySelectorAll('button')).find(b => b.textContent === 'Fix')!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual([{ script: original, error: null, owner: 'button:Go' }]);
    Array.from(t.inspectorHost.querySelectorAll<HTMLButtonElement>('[aria-label="Proposed fix"] button')).find(b => b.textContent === 'Apply')!.click();
    const card = () => t.runtime.currentState!.stack.cards[0];
    expect(card().objects[0].script).toBe(proposal);
    expect(t.ctrl().session!.history.size).toBe(before + 1);
    expect(t.tool('Undo').title).toBe('Undo Edit script of button "Go"');
    // Leave the textarea first, as a user would (Ctrl+Z *in* the textarea is its own text undo).
    t.field('Script').blur();
    t.key('z', { ctrlKey: true }); // on the body, not in a text control
    expect(card().objects[0].script).toBe(original);
    expect(t.field('Script').value).toBe(original);
  });
});
