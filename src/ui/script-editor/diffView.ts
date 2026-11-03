import { diffLines } from './diff.js';

const MARK = { same: ' ', add: '+', del: '−' } as const;
const WORD = { same: 'unchanged', add: 'added', del: 'removed' } as const;

/**
 * The proposed-fix view (REQ-5.4): a line diff of the current script against the proposal, with
 * text markers (−, +) and old/new line numbers so changes are clear without colour.
 */
export class DiffView {
  readonly el: HTMLElement;
  readonly heading: HTMLElement;
  readonly hasChanges: boolean;

  constructor(oldText: string, newText: string, handlers: { apply(): void; cancel(): void }, doc: Document = document) {
    this.el = doc.createElement('section');
    this.el.className = 'diff-view';
    this.el.setAttribute('aria-label', 'Proposed fix');
    this.heading = doc.createElement('h3');
    this.heading.className = 'diff-view-heading';
    this.heading.tabIndex = -1;
    this.heading.textContent = 'Proposed fix';
    this.el.append(this.heading);

    const rows = diffLines(oldText, newText);
    this.hasChanges = rows.some(r => r.kind !== 'same');
    if (!this.hasChanges) {
      const p = doc.createElement('p');
      p.className = 'diff-view-empty';
      p.textContent = 'No changes proposed';
      this.el.append(p);
    } else {
      const wrap = doc.createElement('div');
      wrap.className = 'diff-view-scroll';
      const table = doc.createElement('table');
      table.className = 'diff-view-table font-script';
      const head = doc.createElement('thead');
      const hr = doc.createElement('tr');
      for (const h of ['Old', 'New', 'Change', 'Line']) {
        const th = doc.createElement('th');
        th.scope = 'col';
        th.textContent = h;
        hr.append(th);
      }
      head.append(hr);
      const body = doc.createElement('tbody');
      for (const r of rows) {
        const tr = doc.createElement('tr');
        tr.className = `diff-row diff-row--${r.kind}`;
        const cells = [r.oldLine === null ? '' : String(r.oldLine), r.newLine === null ? '' : String(r.newLine), MARK[r.kind], r.text];
        cells.forEach((text, i) => {
          const td = doc.createElement('td');
          td.className = ['diff-old', 'diff-new', 'diff-mark', 'diff-text'][i];
          td.textContent = text;
          if (i === 2) td.setAttribute('aria-label', WORD[r.kind]);
          tr.append(td);
        });
        body.append(tr);
      }
      table.append(head, body);
      wrap.append(table);
      this.el.append(wrap);
    }

    const actions = doc.createElement('div');
    actions.className = 'script-actions';
    const button = (text: string, run: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'chrome-button';
      b.textContent = text;
      b.addEventListener('click', run);
      return b;
    };
    if (this.hasChanges) actions.append(button('Apply', handlers.apply));
    actions.append(button('Cancel', handlers.cancel));
    this.el.append(actions);

    this.el.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // Handled here so an enclosing Expand dialog stays open.
      e.preventDefault();
      e.stopPropagation();
      handlers.cancel();
    });
  }
}
