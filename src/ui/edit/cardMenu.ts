export interface CardMenuActions {
  newCard(): void;
  deleteCard(): void;
  next(): void;
  prev(): void;
  cardInfo(): void;
}

export interface CardMenu {
  el: HTMLElement;
  setCanDelete(can: boolean): void;
  open(): void;
  close(): void;
}

let seq = 0;

/** The "Card" menu button and its role="menu" list (REQ-6). */
export function createCardMenu(actions: CardMenuActions): CardMenu {
  const el = document.createElement('div');
  el.className = 'card-menu';
  const menuId = `card-menu-${++seq}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chrome-button';
  // The caret is drawn in CSS: the menu glyph is outside the bundled fonts' character range, so it would be drawn by a
  // system font. textContent stays "Card ▾"; the span is hidden from assistive technology (the name is "Card").
  button.append('Card ');
  const caret = document.createElement('span');
  caret.className = 'card-menu-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  button.append(caret);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', menuId);
  const list = document.createElement('ul');
  list.className = 'card-menu-list';
  list.id = menuId;
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Card');
  list.hidden = true;

  const items: HTMLButtonElement[] = [];
  const add = (label: string, run: () => void) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'none');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'card-menu-item';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    item.textContent = label;
    item.addEventListener('click', () => {
      if (item.getAttribute('aria-disabled') === 'true') return;
      close(true);
      run();
    });
    li.append(item);
    list.append(li);
    items.push(item);
    return item;
  };
  add('New Card', actions.newCard);
  const del = add('Delete Card', actions.deleteCard);
  add('Next', actions.next);
  add('Prev', actions.prev);
  add('Card Info…', actions.cardInfo);

  const focusItem = (i: number) => items[(i + items.length) % items.length].focus();
  const open = () => {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    focusItem(0);
  };
  const close = (returnFocus: boolean) => {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus();
  };

  button.addEventListener('click', () => (list.hidden ? open() : close(false)));
  button.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(); }
  });
  list.addEventListener('keydown', e => {
    const i = items.indexOf(el.ownerDocument.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(items.length - 1); }
    else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); close(e.key === 'Escape'); }
  });
  el.ownerDocument.addEventListener('pointerdown', e => {
    if (!el.contains(e.target as Node)) close(false);
  });

  el.append(button, list);
  return {
    el,
    setCanDelete: can => del.setAttribute('aria-disabled', String(!can)),
    open,
    close: () => close(false),
  };
}

export interface CardInfo {
  name: string;
  position: string;
  background: string;
  objects: number;
}

/**
 * The Card Info dialog (chrome, not the card surface, so the top layer is fine). Resolves with
 * the new name on OK, or null on Cancel / Escape.
 */
export function showCardInfo(info: CardInfo, doc: Document = document): Promise<string | null> {
  return new Promise(resolve => {
    const dialog = doc.createElement('dialog');
    dialog.className = 'card-info-dialog font-ui';
    dialog.setAttribute('aria-labelledby', 'card-info-title');
    const title = doc.createElement('h2');
    title.id = 'card-info-title';
    title.textContent = 'Card Info';
    const label = doc.createElement('label');
    label.htmlFor = 'card-info-name';
    label.textContent = 'Name';
    const input = doc.createElement('input');
    input.id = 'card-info-name';
    input.type = 'text';
    input.value = info.name;
    const lines = [info.position, `Background: ${info.background}`, `Objects: ${info.objects}`].map(t => {
      const p = doc.createElement('p');
      p.textContent = t;
      return p;
    });
    const cancel = Object.assign(doc.createElement('button'), { type: 'button', textContent: 'Cancel', className: 'chrome-button' });
    const ok = Object.assign(doc.createElement('button'), { type: 'button', textContent: 'OK', className: 'chrome-button' });
    const buttons = doc.createElement('div');
    buttons.className = 'card-info-buttons';
    buttons.append(cancel, ok);
    dialog.append(title, label, input, ...lines, buttons);

    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    ok.addEventListener('click', () => finish(input.value));
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    dialog.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); finish(input.value); }
    });
    doc.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    input.focus();
    input.select();
  });
}
