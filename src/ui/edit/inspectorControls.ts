/**
 * Labelled inspector controls (REQ-5.4). Each commits on `change` (or on flush) and only when
 * the value differs from the last value set from the model.
 */

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export interface Control<T> {
  readonly el: HTMLElement;
  /** Show the model value (also the reference for "did it change"). */
  set(value: T): void;
  /** Commit pending input if it differs from the model value. */
  commit(): void;
  focus(): void;
  /** True when focus is inside the control (so a re-sync must not overwrite typing). */
  hasFocus(): boolean;
}

function row(labelText: string, input: HTMLElement, className = 'inspector-row'): { el: HTMLElement; note: HTMLElement } {
  const el = document.createElement('div');
  el.className = className;
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = labelText;
  const note = document.createElement('div');
  note.className = 'inspector-note';
  note.id = nextId('note');
  note.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', note.id);
  el.append(label, input, note);
  return { el, note };
}

function focusWithin(el: HTMLElement): boolean {
  return el.contains(el.ownerDocument.activeElement);
}

export interface TextControl extends Control<string> {
  /** Show or clear a warning under the control. */
  warn(message: string | null): void;
}

/** Single-line text (or a textarea with `multiline`). Enter in single-line inputs commits. */
export function textControl(
  label: string, onCommit: (value: string) => void, options: { multiline?: boolean; readOnly?: boolean } = {},
): TextControl {
  const input = options.multiline ? document.createElement('textarea') : document.createElement('input');
  input.id = nextId('insp');
  input.className = 'inspector-input';
  if (input instanceof HTMLInputElement) input.type = 'text';
  else input.rows = 4;
  input.spellcheck = false;
  input.readOnly = options.readOnly === true;
  const { el, note } = row(label, input);
  let last = '';
  const commit = () => {
    if (input.readOnly || input.value === last) return;
    last = input.value;
    onCommit(input.value);
  };
  input.addEventListener('change', commit);
  if (input instanceof HTMLInputElement) {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  }
  return {
    el,
    set: v => { last = v; input.value = v; },
    commit,
    focus: () => input.focus(),
    hasFocus: () => focusWithin(el),
    warn: m => { note.textContent = m ?? ''; note.classList.toggle('inspector-note--warning', m !== null); },
  };
}

/** Integer input: invalid text reverts to the model value with "Enter a whole number". */
export function numberControl(label: string, onCommit: (value: number) => void): Control<number> {
  const input = document.createElement('input');
  input.id = nextId('insp');
  input.className = 'inspector-input inspector-input--number';
  input.type = 'text';
  input.inputMode = 'numeric';
  const { el, note } = row(label, input, 'inspector-row inspector-row--number');
  let last = 0;
  const commit = () => {
    const raw = input.value.trim();
    if (raw === String(last)) { note.textContent = ''; return; }
    if (!/^-?\d+$/.test(raw)) {
      input.value = String(last);
      note.textContent = 'Enter a whole number';
      return;
    }
    note.textContent = '';
    last = Number(raw);
    onCommit(last);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  return {
    el,
    set: v => { last = v; input.value = String(v); },
    commit,
    focus: () => input.focus(),
    hasFocus: () => focusWithin(el),
  };
}

export function checkboxControl(label: string, onCommit: (value: boolean) => void): Control<boolean> {
  const input = document.createElement('input');
  input.id = nextId('insp');
  input.type = 'checkbox';
  input.className = 'inspector-checkbox';
  const { el } = row(label, input, 'inspector-row inspector-row--checkbox');
  let last = false;
  const commit = () => {
    if (input.checked === last) return;
    last = input.checked;
    onCommit(input.checked);
  };
  input.addEventListener('change', commit);
  return {
    el,
    set: v => { last = v; input.checked = v; },
    commit,
    focus: () => input.focus(),
    hasFocus: () => focusWithin(el),
  };
}

export function selectControl(label: string, options: readonly string[], onCommit: (value: string) => void): Control<string> {
  const select = document.createElement('select');
  select.id = nextId('insp');
  select.className = 'inspector-input';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    select.append(opt);
  }
  const { el } = row(label, select);
  let last = '';
  const commit = () => {
    if (select.value === last) return;
    last = select.value;
    onCommit(select.value);
  };
  select.addEventListener('change', commit);
  return {
    el,
    set: v => { last = v; select.value = v; },
    commit,
    focus: () => select.focus(),
    hasFocus: () => focusWithin(el),
  };
}

/** A read-only labelled value (e.g. "Card 2 of 5"). */
export function infoLine(label: string): { el: HTMLElement; set(value: string): void } {
  const el = document.createElement('div');
  el.className = 'inspector-row inspector-row--info';
  const name = document.createElement('span');
  name.className = 'inspector-info-label';
  name.textContent = label;
  const value = document.createElement('span');
  value.className = 'inspector-info-value';
  el.append(name, value);
  return { el, set: v => { value.textContent = v; } };
}
