let seq = 0;

/**
 * Expand (REQ-5.5): show an existing element in a wide chrome <dialog> by *moving* it there, and
 * move the same element back on close. Nothing is copied, so listeners, timers, pending requests,
 * the textarea's value, selection and undo stack all survive. Opening and closing commit nothing.
 */
export class ExpandDialog {
  readonly dialog: HTMLDialogElement;
  private readonly body: HTMLElement;
  private readonly titleEl: HTMLElement;
  private placeholder: Comment | null = null;

  constructor(
    private readonly target: HTMLElement,
    /** `title` may be a function, evaluated on each open (the owner's name can change). */
    private readonly options: { title: string | (() => string); onOpen?(): void; onClose?(): void },
    doc: Document = target.ownerDocument,
  ) {
    this.dialog = doc.createElement('dialog');
    this.dialog.className = 'expand-dialog font-ui';
    const titleId = `expand-title-${++seq}`;
    this.dialog.setAttribute('aria-labelledby', titleId);
    const header = doc.createElement('div');
    header.className = 'expand-dialog-header';
    const h = doc.createElement('h2');
    h.id = titleId;
    h.className = 'expand-dialog-title';
    this.titleEl = h;
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'chrome-button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    header.append(h, close);
    this.body = doc.createElement('div');
    this.body.className = 'expand-dialog-body';
    this.dialog.append(header, this.body);
    // Escape fires `cancel`; close our way (move the element back) instead of the default.
    this.dialog.addEventListener('cancel', e => { e.preventDefault(); this.close(); });
    this.dialog.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); this.close(); }
    });
  }

  get isOpen(): boolean {
    return this.placeholder !== null;
  }

  open(): void {
    if (this.isOpen || !this.target.parentNode) return;
    const doc = this.target.ownerDocument;
    const t = this.options.title;
    this.titleEl.textContent = typeof t === 'function' ? t() : t;
    this.placeholder = doc.createComment('expanded script editor');
    this.target.parentNode.insertBefore(this.placeholder, this.target);
    this.body.append(this.target); // the same element instance, moved
    doc.body.append(this.dialog);
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.options.onOpen?.();
  }

  close(): void {
    const ph = this.placeholder;
    if (!ph) return;
    this.placeholder = null;
    if (ph.parentNode) ph.parentNode.replaceChild(this.target, ph); // back to exactly where it was
    else this.target.remove();
    if (typeof this.dialog.close === 'function' && this.dialog.open) this.dialog.close();
    this.dialog.removeAttribute('open');
    this.dialog.remove();
    this.options.onClose?.();
  }
}
