// The one-line status line under the card. Most messages are problems (script errors, library full) and keep the
// red error style; a neutral notice such as "Opened from a shared link" uses the info style instead. Every message
// is replaced or cleared by the next one, whichever tone it has.
import type { StatusLine } from './runtime.js';

export type StatusTone = 'error' | 'info';

export const STATUS_INFO_CLASS = 'status-line--info';

export interface StatusLineView extends StatusLine {
  el: HTMLDivElement;
  /** Show a message; the default tone is 'error', so existing callers keep the red style. */
  show(message: string, tone?: StatusTone): void;
  clear(): void;
}

export function createStatusLine(doc: Document = document): StatusLineView {
  const el = doc.createElement('div');
  el.className = 'status-line';
  el.setAttribute('role', 'alert');
  return {
    el,
    show(message, tone = 'error') {
      el.classList.toggle(STATUS_INFO_CLASS, tone === 'info');
      el.textContent = message;
    },
    clear() {
      el.classList.remove(STATUS_INFO_CLASS);
      el.textContent = '';
    },
  };
}
