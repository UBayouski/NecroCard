// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor, ERROR_DEBOUNCE_MS, NO_ERRORS } from './codeEditor.js';
import { readSource } from '../browse/readSource.js';

let editor: CodeEditor;
beforeEach(() => {
  vi.useFakeTimers();
  editor = new CodeEditor({ id: 'ed' });
  document.body.replaceChildren(editor.el);
});
afterEach(() => { editor.destroy(); vi.useRealTimers(); document.body.replaceChildren(); });

const mirror = () => editor.el.querySelector('pre')!;
const gutterLines = () => Array.from(editor.el.querySelectorAll('.code-gutter-line')).map(e => e.textContent);
const status = () => editor.el.querySelector('[role="status"]')!.textContent;
const type = (text: string) => {
  editor.textarea.value = text;
  editor.textarea.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  editor.textarea.dispatchEvent(e);
  return e;
};

describe('CodeEditor rendering', () => {
  it('typing updates the mirror spans and the gutter at once', () => {
    type('on mouseUp\n  go next\nend mouseUp');
    expect(mirror().textContent).toBe('on mouseUp\n  go next\nend mouseUp');
    expect(Array.from(mirror().querySelectorAll('.tok-keyword')).map(e => e.textContent)).toEqual(['on', 'go', 'next', 'end']);
    expect(Array.from(mirror().querySelectorAll('.tok-handler')).map(e => e.textContent)).toEqual(['mouseUp', 'mouseUp']);
    expect(gutterLines()).toEqual(['1', '2', '3']);
  });

  it('the mirror only ever contains spans and text — stack text cannot inject elements', () => {
    type('put "<b>bold</b><img src=x>" into x -- <script>');
    const elements = Array.from(mirror().querySelectorAll('*'));
    expect(elements.every(e => e.tagName === 'SPAN')).toBe(true);
    expect(mirror().textContent).toBe('put "<b>bold</b><img src=x>" into x -- <script>');
  });

  it('a trailing newline gets a padded empty last line, like the textarea', () => {
    type('beep\n');
    expect(gutterLines()).toEqual(['1', '2']);
    expect(mirror().textContent).toBe('beep\n ');
  });

  it('mirror and gutter are hidden from assistive technology; the textarea is the control', () => {
    expect(mirror().getAttribute('aria-hidden')).toBe('true');
    expect(editor.el.querySelector('.code-editor-gutter')!.getAttribute('aria-hidden')).toBe('true');
    expect(editor.textarea.getAttribute('aria-describedby')).toBe('ed-status');
    expect(editor.el.querySelector('[role="status"]')!.getAttribute('aria-live')).toBe('polite');
  });

  it('scroll position is copied to the mirror and gutter', () => {
    type(Array.from({ length: 40 }, (_, i) => `beep -- ${i}`).join('\n'));
    editor.textarea.scrollTop = 64;
    editor.textarea.dispatchEvent(new Event('scroll'));
    expect(mirror().scrollTop).toBe(64);
    expect(editor.el.querySelector<HTMLElement>('.code-editor-gutter')!.scrollTop).toBe(64);
  });
});

describe('CodeEditor inline errors', () => {
  it('appears 300 ms after the last input, not before', () => {
    type('on mouseUp\n  go next\nend mouseDown');
    vi.advanceTimersByTime(ERROR_DEBOUNCE_MS - 1);
    expect(status()).toBe(NO_ERRORS);
    expect(editor.textarea.hasAttribute('aria-invalid')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(status()).toMatch(/^Line 3: Expected "end mouseUp"/);
    expect(editor.textarea.getAttribute('aria-invalid')).toBe('true');
    expect(mirror().querySelector('.script-line--error')!.getAttribute('data-line')).toBe('3');
    const marked = editor.el.querySelector('.code-gutter-line--error')!;
    expect(marked.textContent).toBe('!3');
  });

  it('each input restarts the debounce', () => {
    type('on h\nend x');
    vi.advanceTimersByTime(200);
    type('on h\nend xy');
    vi.advanceTimersByTime(200);
    expect(status()).toBe(NO_ERRORS);
    vi.advanceTimersByTime(100);
    expect(status()).toMatch(/^Line 2:/);
  });

  it('fixing the line clears the error, aria-invalid and the marker', () => {
    type('on h\nend x');
    vi.advanceTimersByTime(ERROR_DEBOUNCE_MS);
    type('on h\nend h');
    vi.advanceTimersByTime(ERROR_DEBOUNCE_MS);
    expect(status()).toBe(NO_ERRORS);
    expect(editor.textarea.hasAttribute('aria-invalid')).toBe(false);
    expect(editor.el.querySelector('.script-line--error')).toBeNull();
    expect(editor.el.querySelector('.code-gutter-mark')).toBeNull();
  });

  it('set() checks immediately; setStatus shows a transient message until the next check', () => {
    editor.set('on h\n  put "x\nend h');
    expect(status()).toMatch(/^Line 2: Unterminated string/);
    expect(editor.error?.line).toBe(2);
    editor.setStatus('Asking Summon…');
    expect(status()).toBe('Asking Summon…');
    editor.checkNow();
    expect(status()).toMatch(/^Line 2:/);
  });
});

describe('CodeEditor indent and outdent', () => {
  it('Ctrl+] indents and Ctrl+[ outdents the selected lines, keeping the selection', () => {
    editor.set('on h\nbeep\nend h');
    editor.textarea.setSelectionRange(5, 9); // "beep"
    expect(key(']', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(editor.value).toBe('on h\n  beep\nend h');
    expect([editor.textarea.selectionStart, editor.textarea.selectionEnd]).toEqual([7, 11]);
    expect(mirror().textContent).toBe('on h\n  beep\nend h');
    key('[', { ctrlKey: true });
    expect(editor.value).toBe('on h\nbeep\nend h');
  });

  it('⌘] works on macOS; read-only editors ignore it', () => {
    editor.set('beep');
    editor.textarea.setSelectionRange(0, 0);
    key(']', { metaKey: true });
    expect(editor.value).toBe('  beep');
    editor.setReadOnly(true);
    key(']', { metaKey: true });
    expect(editor.value).toBe('  beep');
  });

  it('Tab and Shift+Tab are never intercepted', () => {
    editor.set('beep');
    expect(key('Tab').defaultPrevented).toBe(false);
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(key('Tab', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(editor.value).toBe('beep');
  });

  /**
   * Record what the browser would be asked to do. Native undo cannot run in happy-dom, so this
   * checks the selection and command it would act on; returning false then exercises the fallback.
   */
  function recordExecCommand() {
    const calls: { command: string; arg?: string; selStart: number; selEnd: number }[] = [];
    const original = document.execCommand;
    document.execCommand = ((command: string, _ui?: boolean, arg?: string) => {
      calls.push({ command, arg, selStart: editor.textarea.selectionStart, selEnd: editor.textarea.selectionEnd });
      return false;
    }) as typeof document.execCommand;
    return { calls, restore: () => { document.execCommand = original; } };
  }

  it('single line: indent asks to insert two spaces at a caret on the line start; caret ends after them', () => {
    const rec = recordExecCommand();
    try {
      editor.set('on h\nbeep\nend h');
      editor.textarea.setSelectionRange(7, 7); // caret inside "beep"
      key(']', { ctrlKey: true });
      expect(rec.calls).toEqual([{ command: 'insertText', arg: '  ', selStart: 5, selEnd: 5 }]);
      expect(editor.value).toBe('on h\n  beep\nend h');
      expect([editor.textarea.selectionStart, editor.textarea.selectionEnd]).toEqual([9, 9]);
    } finally {
      rec.restore();
    }
  });

  it('single line: outdent asks to delete only the selected leading spaces; caret moves back', () => {
    const rec = recordExecCommand();
    try {
      editor.set('on h\n  beep\nend h');
      editor.textarea.setSelectionRange(9, 9);
      key('[', { ctrlKey: true });
      expect(rec.calls).toEqual([{ command: 'delete', arg: undefined, selStart: 5, selEnd: 7 }]);
      expect(editor.value).toBe('on h\nbeep\nend h');
      expect([editor.textarea.selectionStart, editor.textarea.selectionEnd]).toEqual([7, 7]);
    } finally {
      rec.restore();
    }
  });

  it('multi-line: one insertText replaces the whole line range; the selection is kept', () => {
    const rec = recordExecCommand();
    try {
      editor.set('on h\nbeep\nend h');
      editor.textarea.setSelectionRange(1, 8);
      key(']', { ctrlKey: true });
      expect(rec.calls).toEqual([{ command: 'insertText', arg: '  on h\n  beep', selStart: 0, selEnd: 9 }]);
      expect(editor.value).toBe('  on h\n  beep\nend h');
      expect([editor.textarea.selectionStart, editor.textarea.selectionEnd]).toEqual([3, 12]);
    } finally {
      rec.restore();
    }
  });
});

describe('script-editor.css', () => {
  it('every token colour has at least 4.5:1 contrast on white', async () => {
    const css = await readSource('../script-editor/script-editor.css', import.meta.url);
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const rules = css.match(/\.tok-[^{]+\{[^}]*color:\s*#[0-9a-f]{6}/gi) ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(7);
    for (const rule of rules) {
      const hex = rule.match(/color:\s*(#[0-9a-f]{6})/i)![1];
      expect(1.05 / (lum(hex) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
    const tokenRules = css.match(/\.tok-[^{]*\{[^}]*\}/g) ?? [];
    expect(tokenRules.length).toBeGreaterThanOrEqual(5);
    for (const rule of tokenRules) expect(rule).not.toMatch(/font-weight|font-style|letter-spacing|font-size/);
  });

  it('selection backgrounds in the script editor and message box are translucent (alpha < 1)', async () => {
    const css = await readSource('../script-editor/script-editor.css', import.meta.url);
    const rules = css.match(/[^{}]*::selection\s*\{[^}]*\}/g) ?? [];
    const selectors = rules.map(r => r.slice(0, r.indexOf('{')).trim());
    expect(selectors).toEqual(expect.arrayContaining(['.code-editor-input::selection', '.message-box-wrap .message-box::selection']));
    for (const rule of rules) {
      const bg = rule.match(/background(?:-color)?:\s*([^;]+);/)?.[1].trim() ?? '';
      // Only rgba()/hsla()/#rrggbbaa with an alpha below 1 lets the highlighted mirror show through.
      const rgba = bg.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/);
      expect(rgba, `${rule} must use rgba() with alpha`).not.toBeNull();
      expect(Number(rgba![1])).toBeLessThan(1);
      expect(Number(rgba![1])).toBeGreaterThan(0);
    }
  });
});
