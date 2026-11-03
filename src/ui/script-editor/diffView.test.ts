// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiffView } from './diffView.js';

afterEach(() => { document.body.replaceChildren(); });

describe('DiffView', () => {
  it('shows old/new line numbers and text markers for each row', () => {
    const v = new DiffView('on h\n  go nxt\nend h', 'on h\n  go next\nend h', { apply: () => {}, cancel: () => {} });
    expect(v.el.getAttribute('aria-label')).toBe('Proposed fix');
    const rows = Array.from(v.el.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent));
    expect(rows).toEqual([
      ['1', '1', ' ', 'on h'],
      ['2', '', '−', '  go nxt'],
      ['', '2', '+', '  go next'],
      ['3', '3', ' ', 'end h'],
    ]);
    expect(v.el.querySelector('tbody tr:nth-child(2) .diff-mark')!.getAttribute('aria-label')).toBe('removed');
    expect(Array.from(v.el.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Apply', 'Cancel']);
  });

  it('Apply and Cancel call their handlers; Escape cancels without bubbling', () => {
    const apply = vi.fn();
    const cancel = vi.fn();
    const outer = vi.fn();
    const v = new DiffView('a', 'b', { apply, cancel });
    document.body.append(v.el);
    document.body.addEventListener('keydown', outer);
    v.el.querySelectorAll('button')[0].click();
    v.el.querySelectorAll('button')[1].click();
    v.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect([apply.mock.calls.length, cancel.mock.calls.length]).toEqual([1, 2]);
    expect(outer).not.toHaveBeenCalled();
  });

  it('identical scripts: "No changes proposed" and only Cancel', () => {
    const v = new DiffView('beep', 'beep', { apply: () => {}, cancel: () => {} });
    expect(v.hasChanges).toBe(false);
    expect(v.el.textContent).toContain('No changes proposed');
    expect(Array.from(v.el.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Cancel']);
  });

  it('line text is never parsed as HTML', () => {
    const v = new DiffView('', '<img src=x onerror=alert(1)>', { apply: () => {}, cancel: () => {} });
    expect(v.el.querySelector('img')).toBeNull();
  });
});
