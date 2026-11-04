import type { FixtureName } from '../../model/fixtures.js';
import type { LibraryRecord } from '../../share/library.js';

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

/** What the person chose in the picker: a bundled sample or a library entry. */
export type PickerChoice =
  | { kind: 'fixture'; key: FixtureName }
  | { kind: 'entry'; id: string };

export interface StackPicker {
  el: HTMLElement;
  select: HTMLSelectElement;
  /** Rebuild the "My stacks" group from library records (newest-first as given). Keeps "Samples" fixed. */
  setEntries(records: LibraryRecord[]): void;
  /** Select a fixture key or a library entry id. */
  setSelected(value: FixtureName | string): void;
  setDisabled(disabled: boolean): void;
}

const SAMPLES_LABEL = 'Samples';
const MY_STACKS_LABEL = 'My stacks';

/**
 * A labelled <select> with a fixed "Samples" group and a rebuildable "My stacks" group. `onChoose` fires on a
 * person change with the chosen sample or entry. Entry option values are library ids; sample values are fixture
 * keys (disjoint: ids are 10-char random strings, keys are the three fixture names).
 */
export function createStackPicker(onChoose: (choice: PickerChoice) => void): StackPicker {
  const label = document.createElement('label');
  label.className = 'stack-picker';
  label.append('Stack ');
  const select = document.createElement('select');
  select.id = 'stack-picker';

  const samples = document.createElement('optgroup');
  samples.label = SAMPLES_LABEL;
  for (const f of FIXTURES) {
    const option = document.createElement('option');
    option.value = f.key;
    option.textContent = f.name;
    samples.append(option);
  }
  select.append(samples);

  // The "My stacks" group is created on demand and removed when empty.
  let myStacks: HTMLOptGroupElement | null = null;

  const setEntries = (records: LibraryRecord[]): void => {
    myStacks?.remove();
    myStacks = null;
    if (records.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = MY_STACKS_LABEL;
    for (const r of records) {
      const option = document.createElement('option');
      option.value = r.id;
      option.textContent = r.name;
      group.append(option);
    }
    select.append(group);
    myStacks = group;
  };

  const setSelected = (value: string): void => { select.value = value; };

  select.addEventListener('change', () => {
    const value = select.value;
    onChoose(isFixture(value) ? { kind: 'fixture', key: value } : { kind: 'entry', id: value });
  });

  label.append(select);
  return {
    el: label,
    select,
    setEntries,
    setSelected,
    setDisabled: disabled => { select.disabled = disabled; },
  };
}
