// The Delete button and its confirm dialog (stack-library REQ-4.1). Chrome only: it reuses the shared modal
// dialog shell and chromeButton, and never touches the card surface. Rename is via the inspector (no dialog).
import { chromeButton, createDialogShell } from '../summon/dialogShell.js';

export interface DeleteControlDeps {
  /** Perform the deletion (library.delete + reopen the quiz). */
  onConfirm: () => void;
  doc?: Document;
}

export interface DeleteControl {
  button: HTMLButtonElement;
  /** Enable only when a library entry is open and the runtime is idle. */
  setEnabled(enabled: boolean): void;
  /** The name shown in the confirm (the open entry's name). */
  setName(name: string): void;
}

/** A chrome "Delete" button that opens a modal confirm naming the open stack. */
export function createDeleteControl(deps: DeleteControlDeps): DeleteControl {
  const doc = deps.doc ?? document;
  const button = chromeButton(doc, 'Delete');
  button.disabled = true;

  let currentName = '';
  let shell: ReturnType<typeof createDialogShell> | null = null;

  const openConfirm = (): void => {
    shell = createDialogShell('library-delete', 'Delete stack', () => shell?.close(), doc);
    const message = doc.createElement('p');
    message.textContent = `Delete "${currentName}"? This cannot be undone.`;
    const row = doc.createElement('div');
    row.className = 'summon-actions';
    const cancel = chromeButton(doc, 'Cancel');
    const confirm = chromeButton(doc, 'Delete', 'chrome-button--danger');
    cancel.addEventListener('click', () => shell?.close());
    confirm.addEventListener('click', () => {
      shell?.close();
      deps.onConfirm();
    });
    row.append(cancel, confirm);
    shell.body.append(message, row);
    shell.open();
    confirm.focus();
  };

  button.addEventListener('click', () => {
    if (!button.disabled) openConfirm();
  });

  return {
    button,
    setEnabled(enabled) {
      button.disabled = !enabled;
    },
    setName(name) {
      currentName = name;
    },
  };
}
