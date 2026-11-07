import { LineHistory } from './lineHistory.js';
import { renderLineMirror } from './mirror.js';

/** Hint shown in the empty message box so the strip reads as a prompt, not a blank bar. */
export const MESSAGE_BOX_PLACEHOLDER = 'Type a NecroTalk command and press Enter';

/** History shared by every message box on the page (HyperCard's box is global; open question 10). */
const sharedHistory = new LineHistory();

/**
 * The message box (REQ-7): the existing single-line <input> with a highlighted mirror behind its
 * transparent text, and an Up/Down history of submitted lines.
 */
export class MessageBoxInput {
  readonly el: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly mirror: HTMLDivElement;

  constructor(readonly history: LineHistory = sharedHistory, doc: Document = document) {
    this.el = doc.createElement('div');
    this.el.className = 'message-box-wrap';
    this.mirror = doc.createElement('div');
    this.mirror.className = 'message-box-mirror';
    this.mirror.setAttribute('aria-hidden', 'true');
    this.input = doc.createElement('input');
    this.input.type = 'text';
    this.input.className = 'message-box font-script';
    this.input.setAttribute('aria-label', 'Message box');
    this.input.placeholder = MESSAGE_BOX_PLACEHOLDER;
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.el.append(this.mirror, this.input);

    const sync = () => this.render();
    this.input.addEventListener('input', sync);
    this.input.addEventListener('scroll', sync);
    this.input.addEventListener('keyup', sync);
    this.input.addEventListener('select', sync);
    this.input.addEventListener('keydown', e => this.onKeyDown(e));
    this.render();
  }

  get value(): string { return this.input.value; }

  set value(v: string) {
    this.input.value = v;
    this.render();
  }

  set disabled(on: boolean) {
    this.input.disabled = on;
    this.el.classList.toggle('message-box-wrap--disabled', on);
  }

  get disabled(): boolean { return this.input.disabled; }

  /** Record a submitted line (call before running it). */
  submitted(line: string): void {
    this.history.push(line);
  }

  private render(): void {
    renderLineMirror(this.mirror, this.input.value);
    this.mirror.scrollLeft = this.input.scrollLeft;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = e.key === 'ArrowUp' ? this.history.up(this.input.value) : this.history.down();
    if (next === null) return;
    this.input.value = next;
    const end = next.length;
    this.input.setSelectionRange(end, end);
    this.render();
  }
}
