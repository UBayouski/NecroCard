/**
 * 1-bit modal `answer` and `ask` dialogs (REQ-4.4, REQ-4.5).
 *
 * Rendered inside the scaled card surface (not `<dialog>.showModal()`, whose top layer would
 * escape the scale transform). Focus is trapped manually; everything else is made inert.
 */

export interface DialogOptions {
  /** Elements to make inert while the dialog is open (card layer, message box, …). */
  inert?: () => HTMLElement[];
}

let promptSeq = 0;

function makeButton(label: string, isDefault: boolean): { wrap: HTMLElement; button: HTMLButtonElement } {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-roundrect dialog-button font-ui';
  const text = document.createElement('span');
  text.className = 'button-label';
  text.textContent = label;
  button.append(text);
  const wrap = document.createElement('span');
  wrap.className = isDefault ? 'dialog-default-ring' : 'dialog-button-slot';
  wrap.append(button);
  if (isDefault) button.classList.add('button--default');
  return { wrap, button };
}

interface Frame {
  backdrop: HTMLElement;
  body: HTMLElement;
  buttonRow: HTMLElement;
  close: () => void;
}

function openFrame(surface: HTMLElement, prompt: string, options: DialogOptions): Frame {
  const previous = surface.ownerDocument.activeElement as HTMLElement | null;
  const inertEls = (options.inert?.() ?? []).filter(el => !el.inert);
  inertEls.forEach(el => { el.inert = true; });

  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'dialog font-ui';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const promptId = `dialog-prompt-${++promptSeq}`;
  dialog.setAttribute('aria-labelledby', promptId);
  const body = document.createElement('div');
  body.className = 'dialog-body';
  const p = document.createElement('p');
  p.className = 'dialog-prompt';
  p.id = promptId;
  p.textContent = prompt;
  const buttonRow = document.createElement('div');
  buttonRow.className = 'dialog-buttons';
  body.append(p);
  dialog.append(body);
  backdrop.append(dialog);

  // Swallow pointer events so nothing reaches the card underneath.
  for (const type of ['pointerdown', 'pointerup', 'click'] as const) {
    backdrop.addEventListener(type, e => e.stopPropagation());
  }
  // Manual focus trap.
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'));
    if (focusables.length === 0) return;
    const i = focusables.indexOf(surface.ownerDocument.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : (i + 1) % focusables.length;
    e.preventDefault();
    focusables[next].focus();
  });

  surface.append(backdrop);
  return {
    backdrop,
    body,
    buttonRow,
    close: () => {
      backdrop.remove();
      inertEls.forEach(el => { el.inert = false; });
      if (previous && previous.isConnected) previous.focus();
    },
  };
}

/** Show an answer dialog; resolves with the label of the button chosen. The last button is default. */
export function showAnswer(
  surface: HTMLElement, prompt: string, buttons: string[], options: DialogOptions = {},
): Promise<string> {
  const labels = buttons.length > 0 ? buttons.slice(0, 3) : ['OK'];
  return new Promise(resolve => {
    const frame = openFrame(surface, prompt, options);
    const made = labels.map((label, i) => makeButton(label, i === labels.length - 1));
    const finish = (label: string) => { frame.close(); resolve(label); };
    made.forEach(({ wrap, button }, i) => {
      button.addEventListener('click', () => finish(labels[i]));
      frame.buttonRow.append(wrap);
    });
    frame.body.append(frame.buttonRow);
    const defaultButton = made[made.length - 1].button;
    frame.backdrop.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const focused = made.find(m => m.button === surface.ownerDocument.activeElement);
        (focused?.button ?? defaultButton).click();
      }
      // Escape: answer has no cancel, so it is ignored.
    });
    defaultButton.focus();
  });
}

/** Show an ask dialog; resolves with the typed text, or "" on Cancel / Escape. */
export function showAsk(
  surface: HTMLElement, prompt: string, defaultValue: string, options: DialogOptions = {},
): Promise<string> {
  return new Promise(resolve => {
    const frame = openFrame(surface, prompt, options);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dialog-input font-field';
    input.value = defaultValue;
    input.setAttribute('aria-labelledby', frame.backdrop.querySelector('.dialog-prompt')!.id);
    const cancel = makeButton('Cancel', false);
    const ok = makeButton('OK', true);
    frame.buttonRow.append(cancel.wrap, ok.wrap);
    frame.body.append(input, frame.buttonRow);

    const finish = (value: string) => { frame.close(); resolve(value); };
    ok.button.addEventListener('click', () => finish(input.value));
    cancel.button.addEventListener('click', () => finish(''));
    frame.backdrop.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); finish(''); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (surface.ownerDocument.activeElement === cancel.button) finish('');
        else finish(input.value);
      }
    });
    input.focus();
    input.select();
  });
}
