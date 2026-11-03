import { parse } from '../../interp/parser.js';

/**
 * The script editing surface in the inspector. This spec uses a plain textarea; spec
 * `script-editor` replaces `createPlainScriptSlot` and nothing else.
 */
export interface ScriptEditorSlot {
  readonly el: HTMLElement;
  set(source: string): void;
  onCommit(cb: (source: string) => void): void;
  /** Commit pending text if it differs from the last value set. */
  commit(): void;
  focus(): void;
  hasFocus(): boolean;
}

let seq = 0;

/** `No errors`, or the parser's `Line N: …` message. Never throws. */
export function parseStatus(source: string): string {
  if (source.trim() === '') return 'No errors';
  try {
    parse(source);
    return 'No errors';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function createPlainScriptSlot(label: string): ScriptEditorSlot {
  const el = document.createElement('div');
  el.className = 'inspector-row inspector-row--script';
  const id = `script-${++seq}`;
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = label;
  const ta = document.createElement('textarea');
  ta.id = id;
  ta.className = 'inspector-script font-script';
  ta.rows = 10;
  ta.spellcheck = false;
  ta.wrap = 'off';
  const status = document.createElement('div');
  status.className = 'inspector-script-status';
  status.id = `${id}-status`;
  status.setAttribute('aria-live', 'polite');
  ta.setAttribute('aria-describedby', status.id);
  el.append(lab, ta, status);

  let last = '';
  let cb: (source: string) => void = () => {};
  const showStatus = (src: string) => {
    const msg = parseStatus(src);
    status.textContent = msg;
    status.classList.toggle('inspector-script-status--error', msg !== 'No errors');
  };
  const commit = () => {
    if (ta.value === last) return;
    last = ta.value;
    showStatus(ta.value);
    cb(ta.value);
  };
  ta.addEventListener('change', commit);

  return {
    el,
    set: source => { last = source; ta.value = source; showStatus(source); },
    onCommit: f => { cb = f; },
    commit,
    focus: () => { ta.focus(); ta.scrollIntoView?.({ block: 'nearest' }); },
    hasFocus: () => el.contains(el.ownerDocument.activeElement),
  };
}
