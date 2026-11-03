// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModeToggle } from './modeToggle.js';
import { createEditToolbar } from './editToolbar.js';
import { showCardInfo } from './cardMenu.js';

afterEach(() => { document.body.replaceChildren(); });

const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('mode toggle', () => {
  it('is a radiogroup of Browse and Edit with aria-checked and roving tabindex', () => {
    const onChange = vi.fn();
    const t = createModeToggle(onChange);
    document.body.append(t.el);
    expect(t.el.getAttribute('role')).toBe('radiogroup');
    const [browse, edit] = Array.from(t.el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect([browse.textContent, edit.textContent]).toEqual(['Browse', 'Edit']);
    expect(browse.getAttribute('aria-checked')).toBe('true');
    expect([browse.tabIndex, edit.tabIndex]).toEqual([0, -1]);
    edit.click();
    expect(onChange).toHaveBeenCalledWith('edit');
    t.set('edit');
    expect(edit.getAttribute('aria-checked')).toBe('true');
    edit.click(); // already checked: no change event
    expect(onChange).toHaveBeenCalledTimes(1);
    key(edit, 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('browse');
  });

  it('can be disabled while the runtime is busy', () => {
    const onChange = vi.fn();
    const t = createModeToggle(onChange);
    t.setDisabled(true);
    const radios = Array.from(t.el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.every(r => r.disabled)).toBe(true);
    key(radios[0], 'ArrowRight');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('edit toolbar and card menu', () => {
  function toolbar() {
    const actions = {
      addButton: vi.fn(), addField: vi.fn(), addImage: vi.fn(), undo: vi.fn(), redo: vi.fn(),
      newCard: vi.fn(), deleteCard: vi.fn(), next: vi.fn(), prev: vi.fn(), cardInfo: vi.fn(),
    };
    const tb = createEditToolbar(actions);
    document.body.append(tb.el);
    const btn = (text: string) => Array.from(tb.el.querySelectorAll('button')).find(b => b.textContent === text)!;
    return { tb, actions, btn };
  }

  it('tool buttons call their actions', () => {
    const { actions, btn } = toolbar();
    btn('Add button').click();
    btn('Add field').click();
    btn('Add image').click();
    expect([actions.addButton, actions.addField, actions.addImage].map(f => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('undo/redo reflect availability and describe the next step', () => {
    const { tb, btn, actions } = toolbar();
    expect(btn('Undo').disabled).toBe(true);
    expect(btn('Undo').title).toBe('Nothing to undo');
    tb.setUndo('Undo Move button "Go"');
    tb.setRedo('Redo New Card');
    expect(btn('Undo').disabled).toBe(false);
    expect(btn('Undo').title).toBe('Undo Move button "Go"');
    expect(btn('Redo').title).toBe('Redo New Card');
    btn('Redo').click();
    expect(actions.redo).toHaveBeenCalled();
  });

  it('the card menu opens with focus on the first item, navigates with arrows, closes with Escape', () => {
    const { tb, btn } = toolbar();
    const menuButton = btn('Card ▾');
    expect(menuButton.getAttribute('aria-haspopup')).toBe('menu');
    menuButton.click();
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    const items = Array.from(tb.el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items.map(i => i.textContent)).toEqual(['New Card', 'Delete Card', 'Next', 'Prev', 'Card Info…']);
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(items[1], 'ArrowUp');
    key(items[0], 'ArrowUp');
    expect(document.activeElement).toBe(items[4]);
    key(items[4], 'Escape');
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
  });

  it('menu items run their action and close; Delete Card is inert when disabled', () => {
    const { tb, btn, actions } = toolbar();
    const items = () => Array.from(tb.el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    tb.cardMenu.setCanDelete(false);
    btn('Card ▾').click();
    items()[1].click();
    expect(actions.deleteCard).not.toHaveBeenCalled();
    expect(items()[1].getAttribute('aria-disabled')).toBe('true');
    items()[2].click();
    expect(actions.next).toHaveBeenCalled();
    expect(tb.el.querySelector<HTMLElement>('[role="menu"]')!.hidden).toBe(true);
    tb.cardMenu.setCanDelete(true);
    btn('Card ▾').click();
    items()[1].click();
    expect(actions.deleteCard).toHaveBeenCalled();
  });
});

describe('Card Info dialog', () => {
  const info = { name: 'Q1', position: 'Card 2 of 5', background: 'Default', objects: 4 };

  it('shows the card facts and resolves with the edited name on OK', async () => {
    const p = showCardInfo(info);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Card 2 of 5');
    expect(dialog.textContent).toContain('Background: Default');
    expect(dialog.textContent).toContain('Objects: 4');
    const input = dialog.querySelector('input')!;
    expect(input.value).toBe('Q1');
    input.value = 'First question';
    Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'OK')!.click();
    expect(await p).toBe('First question');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('Cancel and Escape resolve null', async () => {
    const p1 = showCardInfo(info);
    Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent === 'Cancel')!.dispatchEvent(new MouseEvent('click'));
    expect(await p1).toBeNull();
    const p2 = showCardInfo(info);
    key(document.querySelector('dialog input')!, 'Escape');
    expect(await p2).toBeNull();
  });
});
