import { createCardMenu, type CardMenu, type CardMenuActions } from './cardMenu.js';

export interface EditToolbarActions extends CardMenuActions {
  addButton(): void;
  addField(): void;
  addImage(): void;
  undo(): void;
  redo(): void;
}

export interface EditToolbar {
  el: HTMLElement;
  cardMenu: CardMenu;
  /** Undo/redo availability; the label (e.g. `Undo Move button "Go"`) becomes the title. */
  setUndo(label: string | null): void;
  setRedo(label: string | null): void;
}

/** Edit-mode toolbar row: tools, card menu, undo and redo (REQ-4.1, REQ-6, REQ-7.3). */
export function createEditToolbar(actions: EditToolbarActions): EditToolbar {
  const el = document.createElement('div');
  el.className = 'edit-toolbar';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Edit tools');
  const button = (text: string, run: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chrome-button';
    b.textContent = text;
    b.addEventListener('click', run);
    return b;
  };
  const cardMenu = createCardMenu(actions);
  const undo = button('Undo', () => actions.undo());
  const redo = button('Redo', () => actions.redo());
  const spacer = document.createElement('span');
  spacer.className = 'edit-toolbar-spacer';
  el.append(
    button('Add button', () => actions.addButton()),
    button('Add field', () => actions.addField()),
    button('Add image', () => actions.addImage()),
    cardMenu.el, spacer, undo, redo,
  );
  const setState = (b: HTMLButtonElement, fallback: string, label: string | null) => {
    b.disabled = label === null;
    b.title = label ?? `Nothing to ${fallback.toLowerCase()}`;
  };
  setState(undo, 'Undo', null);
  setState(redo, 'Redo', null);
  return {
    el,
    cardMenu,
    setUndo: label => setState(undo, 'Undo', label),
    setRedo: label => setState(redo, 'Redo', label),
  };
}
