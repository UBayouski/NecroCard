import type { FixtureName } from '../../model/fixtures.js';

/** Bundled stacks in picker order. Names match each fixture's `name` (REQ-6). */
export const FIXTURES: readonly { key: FixtureName; name: string }[] = [
  { key: 'quiz', name: 'The Haunted Quiz' },
  { key: 'adventure', name: 'The Cursed Manor' },
  { key: 'flashcards', name: 'Spooky Flashcards' },
];

export const DEFAULT_FIXTURE: FixtureName = 'quiz';

function isFixture(value: string | null): value is FixtureName {
  return FIXTURES.some(f => f.key === value);
}

/** The fixture named by `?stack=` in a query string; unknown or missing → quiz. */
export function fixtureFromSearch(search: string): FixtureName {
  const value = new URLSearchParams(search).get('stack');
  return isFixture(value) ? value : DEFAULT_FIXTURE;
}

/** The same URL with `?stack=` set, keeping other parameters and the hash. */
export function urlWithFixture(href: string, key: FixtureName): string {
  const url = new URL(href);
  url.searchParams.set('stack', key);
  return url.toString();
}

export interface StackPicker {
  el: HTMLElement;
  select: HTMLSelectElement;
  setValue(key: PickerValue): void;
  setDisabled(disabled: boolean): void;
  /** Add (if missing) and select an "Untitled" entry for a new stack (edit-mode REQ-1.5). */
  showUntitled(): void;
  /** Add or rename, and select, one entry showing a summoned stack's name (summon REQ-8.3). */
  showCustom(name: string): void;
}

/** Picker value for a stack made with New Stack. */
export const UNTITLED = 'untitled';
/** Picker value for a summoned stack. */
export const CUSTOM = 'custom';

export type PickerValue = FixtureName | typeof UNTITLED | typeof CUSTOM;

/** A labelled <select> of the bundled stacks. `onChange` receives the chosen fixture key. */
export function createStackPicker(onChange: (key: FixtureName) => void): StackPicker {
  const label = document.createElement('label');
  label.className = 'stack-picker';
  label.append('Stack ');
  const select = document.createElement('select');
  select.id = 'stack-picker';
  for (const f of FIXTURES) {
    const option = document.createElement('option');
    option.value = f.key;
    option.textContent = f.name;
    select.append(option);
  }
  const extra = (value: string) => select.querySelector<HTMLOptionElement>(`option[value="${value}"]`);
  const addExtra = (value: string, text: string) => {
    const option = extra(value) ?? document.createElement('option');
    option.value = value;
    option.textContent = text;
    if (!option.parentNode) select.append(option);
  };
  // Untitled and the summoned entry are transient (no persistence until spec `sharing`):
  // choosing anything else removes them.
  const setValue = (key: PickerValue) => {
    if (key === UNTITLED && !extra(UNTITLED)) addExtra(UNTITLED, 'Untitled');
    if (key !== UNTITLED) extra(UNTITLED)?.remove();
    if (key !== CUSTOM) extra(CUSTOM)?.remove();
    select.value = key;
  };
  select.addEventListener('change', () => {
    if (isFixture(select.value)) onChange(select.value);
  });
  label.append(select);
  return {
    el: label,
    select,
    setValue,
    setDisabled: disabled => { select.disabled = disabled; },
    showUntitled: () => setValue(UNTITLED),
    showCustom: name => {
      addExtra(CUSTOM, name.trim() === '' ? 'Summoned stack' : name);
      setValue(CUSTOM);
    },
  };
}
