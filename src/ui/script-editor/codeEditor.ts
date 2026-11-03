import { findError, type ScriptError } from './errors.js';
import { shiftLines } from './indent.js';
import { renderGutter, renderMirror } from './mirror.js';

export const ERROR_DEBOUNCE_MS = 300;
export const NO_ERRORS = 'No errors';

export interface CodeEditorOptions {
  /** id for the textarea (a visible <label for> is created by the caller). */
  id: string;
  rows?: 10 | 24;
  debounceMs?: number;
}

/**
 * NecroTalk editor: the real <textarea> (transparent text, visible caret) over a highlighted
 * mirror, a line-number gutter, and a status region with the first parse error (REQ-1–REQ-4).
 */
export class CodeEditor {
  readonly el: HTMLDivElement;
  readonly textarea: HTMLTextAreaElement;
  private readonly mirror: HTMLPreElement;
  private readonly gutter: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: ScriptError | null = null;
  private listeners: (() => void)[] = [];
  private statusOverride: string | null = null;

  constructor(options: CodeEditorOptions, doc: Document = document) {
    this.debounceMs = options.debounceMs ?? ERROR_DEBOUNCE_MS;
    this.el = doc.createElement('div');
    this.el.className = 'code-editor';
    const body = doc.createElement('div');
    body.className = 'code-editor-body';
    this.gutter = doc.createElement('div');
    this.gutter.className = 'code-editor-gutter code-metrics';
    this.gutter.setAttribute('aria-hidden', 'true');
    const text = doc.createElement('div');
    text.className = 'code-editor-text';
    this.mirror = doc.createElement('pre');
    this.mirror.className = 'code-editor-mirror code-metrics font-script';
    this.mirror.setAttribute('aria-hidden', 'true');
    this.textarea = doc.createElement('textarea');
    this.textarea.id = options.id;
    this.textarea.className = 'code-editor-input code-metrics font-script';
    this.textarea.spellcheck = false;
    this.textarea.wrap = 'off';
    this.textarea.setAttribute('autocapitalize', 'off');
    this.textarea.setAttribute('autocomplete', 'off');
    this.status = doc.createElement('div');
    this.status.className = 'code-editor-status';
    this.status.id = `${options.id}-status`;
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.textarea.setAttribute('aria-describedby', this.status.id);
    text.append(this.mirror, this.textarea);
    body.append(this.gutter, text);
    this.el.append(body, this.status);
    this.setRows(options.rows ?? 10);

    this.textarea.addEventListener('input', () => this.onInputEvent());
    this.textarea.addEventListener('scroll', () => this.syncScroll());
    this.textarea.addEventListener('keydown', e => this.onKeyDown(e));
    this.render();
    this.showStatus();
  }

  get value(): string { return this.textarea.value; }
  get error(): ScriptError | null { return this.current; }

  /** Replace the text, re-highlight and check for errors immediately. */
  set(source: string): void {
    this.textarea.value = source;
    this.cancelTimer();
    this.current = findError(source);
    this.statusOverride = null;
    this.render();
    this.showStatus();
  }

  setRows(rows: 10 | 24): void {
    this.el.classList.toggle('code-editor--rows-10', rows === 10);
    this.el.classList.toggle('code-editor--rows-24', rows === 24);
  }

  setReadOnly(on: boolean): void {
    this.textarea.readOnly = on;
    this.el.classList.toggle('code-editor--readonly', on);
  }

  /** Show a transient message (e.g. "Asking Summon…"); cleared by the next error check or null. */
  setStatus(text: string | null): void {
    this.statusOverride = text;
    this.showStatus();
  }

  onInput(cb: () => void): void { this.listeners.push(cb); }

  destroy(): void { this.cancelTimer(); }

  /** Run the debounced error check now (used before commits and by tests). Clears setStatus text. */
  checkNow(): void {
    this.cancelTimer();
    this.current = findError(this.textarea.value);
    this.statusOverride = null;
    this.render();
    this.showStatus();
  }

  private onInputEvent(): void {
    this.render();
    this.cancelTimer();
    this.timer = setTimeout(() => { this.timer = null; this.checkNow(); }, this.debounceMs);
    for (const cb of this.listeners) cb();
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private render(): void {
    const src = this.textarea.value;
    const line = this.current?.line ?? null;
    renderMirror(this.mirror, src, line);
    renderGutter(this.gutter, src.split('\n').length, line);
    this.syncScroll();
  }

  private showStatus(): void {
    const err = this.current;
    if (this.statusOverride !== null) {
      this.status.textContent = this.statusOverride;
      this.status.classList.remove('code-editor-status--error');
    } else {
      this.status.textContent = err ? err.message : NO_ERRORS;
      this.status.classList.toggle('code-editor-status--error', err !== null);
    }
    if (err) this.textarea.setAttribute('aria-invalid', 'true');
    else this.textarea.removeAttribute('aria-invalid');
  }

  private syncScroll(): void {
    this.mirror.scrollTop = this.textarea.scrollTop;
    this.mirror.scrollLeft = this.textarea.scrollLeft;
    this.gutter.scrollTop = this.textarea.scrollTop;
  }

  /** Ctrl/⌘ + ] indents, Ctrl/⌘ + [ outdents (REQ-4). Tab is never intercepted. */
  private onKeyDown(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || this.textarea.readOnly) return;
    const dir = e.key === ']' || e.code === 'BracketRight' ? 'in'
      : e.key === '[' || e.code === 'BracketLeft' ? 'out' : null;
    if (!dir) return;
    e.preventDefault();
    const ta = this.textarea;
    const shift = shiftLines(ta.value, ta.selectionStart, ta.selectionEnd, dir);
    if (!shift) return;
    ta.setSelectionRange(shift.from, shift.to);
    // execCommand keeps the textarea's own undo stack (open question 4); fall back if unsupported.
    // Single-line shifts touch only the indentation (insert two spaces at the line start, or
    // delete the leading spaces), so the browser's undo leaves a caret instead of a selection.
    let ok: boolean;
    try {
      const doc = ta.ownerDocument;
      ok = typeof doc.execCommand === 'function' && (shift.insert === ''
        ? doc.execCommand('delete', false)
        : doc.execCommand('insertText', false, shift.insert));
    } catch {
      ok = false;
    }
    if (!ok || ta.value !== shift.text) {
      ta.value = shift.text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(shift.selStart, shift.selEnd);
  }
}
