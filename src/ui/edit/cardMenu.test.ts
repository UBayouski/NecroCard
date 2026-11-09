// @vitest-environment happy-dom
// The Card menu's checkable "Edit Background" item (edit-background REQ-3.2, REQ-1.1, design §5.1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardMenu } from './cardMenu.js';

afterEach(() => { document.body.replaceChildren(); });

function menu() {
  const actions = {
    newCard: vi.fn(), deleteCard: vi.fn(), next: vi.fn(), prev: vi.fn(), cardInfo: vi.fn(), editBackground: vi.fn(),
  };
  const m = createCardMenu(actions);
  document.body.append(m.el);
  const item = () => m.el.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
  return { m, actions, item };
}

describe('Card menu: Edit Background item', () => {
  it('is a menuitemcheckbox whose aria-checked follows setEditBackground', () => {
    const { m, item } = menu();
    expect(item().textContent).toContain('Edit Background');
    expect(item().getAttribute('aria-checked')).toBe('false');
    m.setEditBackground(true);
    expect(item().getAttribute('aria-checked')).toBe('true');
    m.setEditBackground(false);
    expect(item().getAttribute('aria-checked')).toBe('false');
  });

  it('choosing it calls the editBackground action once, closes the menu, and does not flip the check itself', () => {
    const { m, actions, item } = menu();
    m.open();
    item().click();
    expect(actions.editBackground).toHaveBeenCalledTimes(1);
    expect(m.el.querySelector<HTMLElement>('[role="menu"]')!.hidden).toBe(true);
    // The check mirrors the session's layer, so only setEditBackground changes it.
    expect(item().getAttribute('aria-checked')).toBe('false');
  });

  it('shows the Ctrl+B shortcut hint as plain text inside the item', () => {
    const { item } = menu();
    const hint = item().querySelector<HTMLElement>('.card-menu-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toBe('Ctrl+B');
  });
});
