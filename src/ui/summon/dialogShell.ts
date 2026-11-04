// A modal chrome <dialog> with a title, as used by the Expand dialog: showModal() traps focus and makes the
// rest of the page inert; Escape fires `cancel`, which the owner handles.

let seq = 0;

export interface DialogShell {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createDialogShell(className: string, title: string, onEscape: () => void, doc: Document = document): DialogShell {
  const dialog = doc.createElement('dialog');
  dialog.className = `summon-dialog ${className} font-ui`;
  const titleId = `${className}-title-${++seq}`;
  dialog.setAttribute('aria-labelledby', titleId);
  const h = doc.createElement('h2');
  h.id = titleId;
  h.className = 'summon-dialog-title';
  h.textContent = title;
  const body = doc.createElement('div');
  body.className = 'summon-dialog-body';
  dialog.append(h, body);
  dialog.addEventListener('cancel', e => {
    e.preventDefault();
    onEscape();
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      onEscape();
    }
  });
  let isOpen = false;
  return {
    dialog,
    body,
    get isOpen() {
      return isOpen;
    },
    open() {
      if (isOpen) return;
      isOpen = true;
      doc.body.append(dialog);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      dialog.removeAttribute('open');
      dialog.remove();
    },
  };
}

export function chromeButton(doc: Document, text: string, className = ''): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = `chrome-button ${className}`.trim();
  b.textContent = text;
  return b;
}
