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
  setValue(key: FixtureName | typeof UNTITLED): void;
  setDisabled(disabled: boolean): void;
  /** Add (if missing) and select an "Untitled" entry for a new stack (edit-mode REQ-1.5). */
  showUntitled(): void;
}

/** Picker value for a stack made with New Stack. */
export const UNTITLED = 'untitled';

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
  const untitled = () => select.querySelector<HTMLOptionElement>(`option[value="${UNTITLED}"]`);
  const setValue = (key: FixtureName | typeof UNTITLED) => {
    if (key === UNTITLED && !untitled()) {
      const option = document.createElement('option');
      option.value = UNTITLED;
      option.textContent = 'Untitled';
      select.append(option);
    } else if (key !== UNTITLED) {
      untitled()?.remove(); // a fixture was chosen: the new stack is gone (no persistence)
    }
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
  };
}
