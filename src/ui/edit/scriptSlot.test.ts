// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScriptSlot } from './scriptSlot.js';
import { createStubAgentClient, type AgentClient, type ScriptContext } from '../../summon/agentClient.js';

const ctx: ScriptContext = { owner: { type: 'button', name: 'Go' }, stackName: 'S', cardName: 'One', backgroundName: 'Main', objectNames: [] };

/** An agent whose answers the test resolves by hand. */
function manualAgent() {
  const calls: { kind: 'explain' | 'fix'; script: string; error?: string | null; signal?: AbortSignal; resolve(v: string): void; reject(e: unknown): void }[] = [];
  const agent: AgentClient = {
    explain: (script, _c, signal) => new Promise((resolve, reject) => { calls.push({ kind: 'explain', script, signal, resolve, reject }); }),
    fix: (script, error, _c, signal) => new Promise((resolve, reject) => { calls.push({ kind: 'fix', script, error, signal, resolve, reject }); }),
  };
  return { agent, calls };
}

function setup(agent: AgentClient = createStubAgentClient()) {
  const messages: string[] = [];
  const status = { show: (m: string) => messages.push(m), clear: () => { messages.length = 0; } };
  const slot = createScriptSlot('Script', { agent, status, context: () => ctx });
  const onCommit = vi.fn();
  slot.onCommit(onCommit);
  document.body.append(slot.el);
  const btn = (text: string) => Array.from(slot.el.querySelectorAll('button')).find(b => b.textContent === text && !b.closest('[hidden]'));
  const ta = () => slot.el.querySelector('textarea')!;
  return { slot, onCommit, messages, btn, ta };
}

const tick = () => new Promise(r => setTimeout(r, 0));

afterEach(() => { document.body.replaceChildren(); });

describe('script slot — Explain and Fix', () => {
  it('with the stub, both report "Summon is not configured" in the status line and restore the editor', async () => {
    const t = setup();
    t.slot.set('on h\nend h');
    t.btn('Explain')!.click();
    await tick();
    expect(t.messages).toEqual(['Summon is not configured']);
    t.btn('Fix')!.click();
    await tick();
    expect(t.messages).toEqual(['Summon is not configured']);
    expect(t.ta().readOnly).toBe(false);
    expect(t.btn('Explain')!.disabled).toBe(false);
  });

  it('Explain with a real-looking client shows the explanation panel', async () => {
    const m = manualAgent();
    const t = setup(m.agent);
    t.slot.set('on mouseUp\n  go next\nend mouseUp');
    t.btn('Explain')!.click();
    expect(t.ta().readOnly).toBe(true);
    expect(t.slot.el.querySelector('[role="status"]')!.textContent).toBe('Asking Summon…');
    m.calls[0].resolve('Goes to the next card when clicked.');
    await tick();
    const panel = t.slot.el.querySelector<HTMLElement>('[aria-label="Explanation"]')!;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('Goes to the next card when clicked.');
    expect(t.ta().readOnly).toBe(false);
  });

  it('Fix sends the current inline error, shows the diff, and Apply commits once', async () => {
    const m = manualAgent();
    const t = setup(m.agent);
    t.slot.set('on mouseUp\n  go next\nend mouseDown');
    t.btn('Fix')!.click();
    expect(m.calls[0]).toMatchObject({ kind: 'fix', script: 'on mouseUp\n  go next\nend mouseDown', error: expect.stringMatching(/^Line 3:/) });
    m.calls[0].resolve('on mouseUp\n  go next\nend mouseUp');
    await tick();
    const diff = t.slot.el.querySelector('[aria-label="Proposed fix"]')!;
    expect(diff).not.toBeNull();
    expect(t.slot.el.querySelector<HTMLElement>('.code-editor')!.hidden).toBe(true);
    expect(document.activeElement).toBe(diff.querySelector('h3'));
    Array.from(diff.querySelectorAll('button')).find(b => b.textContent === 'Apply')!.click();
    expect(t.onCommit).toHaveBeenCalledTimes(1);
    expect(t.onCommit).toHaveBeenCalledWith('on mouseUp\n  go next\nend mouseUp');
    expect(t.ta().value).toBe('on mouseUp\n  go next\nend mouseUp');
    expect(t.slot.el.querySelector('[aria-label="Proposed fix"]')).toBeNull();
    expect(t.slot.el.querySelector('[role="status"]')!.textContent).toBe('No errors');
  });

  it('Cancel in the diff changes nothing', async () => {
    const m = manualAgent();
    const t = setup(m.agent);
    t.slot.set('beep');
    t.btn('Fix')!.click();
    m.calls[0].resolve('beep\nbeep');
    await tick();
    Array.from(t.slot.el.querySelectorAll('[aria-label="Proposed fix"] button')).find(b => b.textContent === 'Cancel')!.dispatchEvent(new MouseEvent('click'));
    expect(t.onCommit).not.toHaveBeenCalled();
    expect(t.ta().value).toBe('beep');
    expect(t.ta().readOnly).toBe(false);
  });

  it('Cancel while pending aborts the request and ignores a late result', async () => {
    const m = manualAgent();
    const t = setup(m.agent);
    t.slot.set('beep');
    t.btn('Fix')!.click();
    t.btn('Cancel')!.click();
    expect(m.calls[0].signal!.aborted).toBe(true);
    m.calls[0].resolve('something else');
    await tick();
    expect(t.slot.el.querySelector('[aria-label="Proposed fix"]')).toBeNull();
    expect(t.ta().readOnly).toBe(false);
    expect(t.messages).toEqual([]);
  });

  it('commit() during a pending request or an open diff commits the unchanged editor text', async () => {
    const m = manualAgent();
    const t = setup(m.agent);
    t.slot.set('beep');
    t.ta().value = 'beep -- typed before asking';
    t.btn('Fix')!.click();
    t.slot.commit();
    expect(t.onCommit).toHaveBeenLastCalledWith('beep -- typed before asking');
    m.calls[0].resolve('beep');
    await tick();
    t.slot.commit();
    expect(t.onCommit).toHaveBeenCalledTimes(1);
  });

  it('an external change (undo) while the diff is open closes it and shows the new text', async () => {
    const m = manualAgent();
    const t = setup(m.agent);
    t.slot.set('beep');
    t.btn('Fix')!.click();
    m.calls[0].resolve('beep\nbeep');
    await tick();
    t.slot.set('on h\nend h');
    expect(t.slot.el.querySelector('[aria-label="Proposed fix"]')).toBeNull();
    expect(t.ta().value).toBe('on h\nend h');
  });
});

describe('scriptContext', () => {
  it('describes object, card, background and stack owners', async () => {
    const { scriptContext } = await import('./scriptContext.js');
    const { makeStack, background, button, field } = await import('../browse/testStacks.js');
    const go = button('Go');
    const stack = makeStack({
      name: 'Haunt',
      backgrounds: [background('Main', [field('Log')])],
      cards: [{ name: 'One', objects: [go] }],
    });
    const view = { stack, cardIndex: 0 };
    const card = stack.cards[0];
    expect(scriptContext(view, { kind: 'object', target: { kind: 'card', cardId: card.id }, objectId: go.id })).toEqual({
      owner: { type: 'button', name: 'Go' }, stackName: 'Haunt', cardName: 'One', backgroundName: 'Main',
      objectNames: [{ type: 'button', name: 'Go' }, { type: 'field', name: 'Log' }],
    });
    expect(scriptContext(view, { kind: 'card', cardId: card.id }).owner).toEqual({ type: 'card', name: 'One' });
    expect(scriptContext(view, { kind: 'background', backgroundId: card.backgroundId })).toMatchObject({ owner: { type: 'background', name: 'Main' }, cardName: null });
    expect(scriptContext(view, { kind: 'stack' })).toMatchObject({ owner: { type: 'stack', name: 'Haunt' }, cardName: null, backgroundName: null });
  });
});
