// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScriptSlot } from '../edit/scriptSlot.js';
import { createStubAgentClient } from '../../summon/agentClient.js';
import { ExpandDialog } from './expandDialog.js';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function slotInPanel() {
  const panel = document.createElement('aside');
  const before = document.createElement('div');
  const after = document.createElement('div');
  const onCommit = vi.fn();
  const slot = createScriptSlot('Script', {
    agent: createStubAgentClient(), context: () => ({ owner: { type: 'button', name: 'Go' }, stackName: 'S', cardName: 'C', backgroundName: 'B', objectNames: [] }),
    status: { show: () => {}, clear: () => {} },
  });
  slot.onCommit(onCommit);
  panel.append(before, slot.el, after);
  document.body.append(panel);
  const work = slot.el.querySelector<HTMLElement>('.script-work')!;
  const textarea = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
  const expand = () => Array.from(slot.el.querySelectorAll('button')).find(b => b.classList.contains('script-expand'))!;
  return { panel, slot, work, onCommit, textarea, expand };
}

describe('Expand dialog', () => {
  it('moves the same editor element instance into the dialog and back on Close', () => {
    vi.useFakeTimers();
    const { slot, work, textarea, expand, onCommit } = slotInPanel();
    slot.set('on mouseUp\n  go next\nend mouseUp');
    const parent = work.parentElement;
    const next = work.nextSibling;
    const ta = textarea();
    ta.value = 'on mouseUp\n  go nxt @\nend mouseUp'; // typed, not committed
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    const errorBefore = work.querySelector('[role="status"]')!.textContent;
    expect(errorBefore).toMatch(/^Line 2:/);

    expand().click();
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector('h2')!.textContent).toBe('Script of button "Go"');
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')!.id);
    expect(dialog.contains(work)).toBe(true);           // the very same element
    expect(dialog.querySelector('.script-work')).toBe(work);
    expect(document.querySelectorAll('.script-work').length).toBe(1); // no second editor
    expect(textarea()).toBe(ta);
    expect(ta.value).toBe('on mouseUp\n  go nxt @\nend mouseUp');
    expect(work.querySelector('[role="status"]')!.textContent).toBe(errorBefore);
    expect(work.querySelector('.code-editor')!.classList.contains('code-editor--rows-24')).toBe(true);
    expect(expand().textContent).toBe('Expanded');
    expect(expand().disabled).toBe(true);
    expect(document.activeElement).toBe(ta);

    Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Close')!.click();
    expect(work.parentElement).toBe(parent);
    expect(work.nextSibling).toBe(next);                 // same position among its siblings
    expect(document.querySelector('dialog')).toBeNull();
    expect(ta.value).toBe('on mouseUp\n  go nxt @\nend mouseUp');
    expect(work.querySelector('.code-editor')!.classList.contains('code-editor--rows-10')).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();             // Close commits nothing
    expect(document.activeElement).toBe(expand());

    slot.commit();                                       // the normal flush rule still commits once
    slot.commit();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('on mouseUp\n  go nxt @\nend mouseUp');
  });

  it('Escape closes and moves the element back; a blur inside the dialog still commits normally', () => {
    const { slot, work, textarea, expand, onCommit } = slotInPanel();
    slot.set('beep');
    const parent = work.parentElement;
    expand().click();
    textarea().value = 'beep\nbeep';
    textarea().dispatchEvent(new Event('change')); // what a blur does
    expect(onCommit).toHaveBeenCalledWith('beep\nbeep');
    document.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(work.parentElement).toBe(parent);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('destroy closes an open dialog and puts the element back before the slot is discarded', () => {
    const { slot, work, expand, panel } = slotInPanel();
    expand().click();
    slot.destroy();
    expect(document.querySelector('dialog')).toBeNull();
    expect(panel.contains(work)).toBe(true);
  });

  it('works for any element and keeps listeners attached', () => {
    const host = document.createElement('div');
    const target = document.createElement('button');
    const clicked = vi.fn();
    target.addEventListener('click', clicked);
    host.append(target);
    document.body.append(host);
    const d = new ExpandDialog(target, { title: 'T' });
    d.open();
    expect(d.isOpen).toBe(true);
    target.click();
    d.close();
    target.click();
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(host.firstChild).toBe(target);
    expect(d.isOpen).toBe(false);
  });
});
