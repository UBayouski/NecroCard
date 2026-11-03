export type Mode = 'browse' | 'edit';

export interface ModeToggle {
  el: HTMLElement;
  set(mode: Mode): void;
  setDisabled(disabled: boolean): void;
}

/** "Browse | Edit" radiogroup in the chrome toolbar (REQ-1.1). Arrow keys switch, as for radios. */
export function createModeToggle(onChange: (mode: Mode) => void): ModeToggle {
  const el = document.createElement('div');
  el.className = 'mode-toggle';
  el.setAttribute('role', 'radiogroup');
  el.setAttribute('aria-label', 'Mode');
  const make = (mode: Mode, label: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chrome-button mode-toggle-option';
    b.setAttribute('role', 'radio');
    b.dataset.mode = mode;
    b.textContent = label;
    b.addEventListener('click', () => { if (b.getAttribute('aria-checked') !== 'true') onChange(mode); });
    return b;
  };
  const browse = make('browse', 'Browse');
  const edit = make('edit', 'Edit');
  el.append(browse, edit);
  el.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || browse.disabled) return;
    e.preventDefault();
    const target = browse.getAttribute('aria-checked') === 'true' ? edit : browse;
    target.focus();
    target.click();
  });

  const set = (mode: Mode) => {
    for (const b of [browse, edit]) {
      const on = b.dataset.mode === mode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('mode-toggle-option--on', on);
    }
  };
  set('browse');
  return {
    el,
    set,
    setDisabled: d => { browse.disabled = d; edit.disabled = d; },
  };
}
