// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createStackPicker, fixtureFromSearch, FIXTURES, urlWithFixture, type PickerChoice } from './stackPicker.js';
import { loadFixture } from '../../model/fixtures.js';
import type { LibraryRecord } from '../../share/library.js';

const record = (id: string, name: string, updatedAt = '2026-01-01T00:00:00.000Z'): LibraryRecord =>
  ({ id, name, stackName: name, createdAt: updatedAt, updatedAt });

const groups = (picker: ReturnType<typeof createStackPicker>) =>
  Array.from(picker.select.querySelectorAll('optgroup')).map(g => g.label);

const optionsIn = (picker: ReturnType<typeof createStackPicker>, label: string) => {
  const group = Array.from(picker.select.querySelectorAll('optgroup')).find(g => g.label === label);
  return group ? Array.from(group.querySelectorAll('option')).map(o => [o.value, o.textContent]) : [];
};

describe('stack picker: samples group', () => {
  it('lists the three fixtures in order under "Samples", labelled by stack name', () => {
    const picker = createStackPicker(() => {});
    expect(groups(picker)).toEqual(['Samples']); // "My stacks" omitted when empty
    expect(optionsIn(picker, 'Samples')).toEqual([
      ['quiz', 'The Haunted Quiz'],
      ['adventure', 'The Cursed Manor'],
      ['flashcards', 'Spooky Flashcards'],
    ]);
    expect(picker.el.tagName).toBe('LABEL');
    expect(picker.el.textContent).toContain('Stack');
  });

  it('hard-coded names match the fixture files', async () => {
    for (const f of FIXTURES) expect((await loadFixture(f.key)).name).toBe(f.name);
  });

  it('reports a sample choice and can be disabled', () => {
    const onChoose = vi.fn();
    const picker = createStackPicker(onChoose);
    picker.setSelected('flashcards');
    picker.select.dispatchEvent(new Event('change'));
    expect(onChoose).toHaveBeenCalledWith({ kind: 'fixture', key: 'flashcards' } satisfies PickerChoice);
    picker.setDisabled(true);
    expect(picker.select.disabled).toBe(true);
  });

  it('?stack= selects a fixture; anything else falls back to quiz', () => {
    expect(fixtureFromSearch('?stack=adventure')).toBe('adventure');
    expect(fixtureFromSearch('?stack=FLASHCARDS')).toBe('quiz');
    expect(fixtureFromSearch('?stack=../../etc')).toBe('quiz');
    expect(fixtureFromSearch('')).toBe('quiz');
  });

  it('urlWithFixture sets the parameter and keeps the rest', () => {
    expect(urlWithFixture('http://localhost:5173/?x=1#top', 'flashcards'))
      .toBe('http://localhost:5173/?x=1&stack=flashcards#top');
  });
});

describe('stack picker: My stacks group', () => {
  it('renders the entries in the given order, labelled by library name', () => {
    const picker = createStackPicker(() => {});
    picker.setEntries([record('id1', 'Ghost Quiz', '2026-03-01T00:00:00.000Z'), record('id2', 'Untitled')]);
    expect(groups(picker)).toEqual(['Samples', 'My stacks']);
    expect(optionsIn(picker, 'My stacks')).toEqual([['id1', 'Ghost Quiz'], ['id2', 'Untitled']]);
  });

  it('choosing an entry reports an entry choice; choosing a sample reports a fixture choice', () => {
    const onChoose = vi.fn();
    const picker = createStackPicker(onChoose);
    picker.setEntries([record('idA', 'My Deck')]);
    picker.setSelected('idA');
    picker.select.dispatchEvent(new Event('change'));
    expect(onChoose).toHaveBeenLastCalledWith({ kind: 'entry', id: 'idA' } satisfies PickerChoice);
    picker.setSelected('quiz');
    picker.select.dispatchEvent(new Event('change'));
    expect(onChoose).toHaveBeenLastCalledWith({ kind: 'fixture', key: 'quiz' } satisfies PickerChoice);
  });

  it('setEntries rebuilds the group and omits it again when empty', () => {
    const picker = createStackPicker(() => {});
    picker.setEntries([record('id1', 'A'), record('id2', 'B')]);
    expect(optionsIn(picker, 'My stacks')).toHaveLength(2);
    picker.setEntries([record('id3', 'C')]);
    expect(optionsIn(picker, 'My stacks')).toEqual([['id3', 'C']]);
    picker.setEntries([]);
    expect(groups(picker)).toEqual(['Samples']);
  });

  it('does not render entry labels as HTML', () => {
    const picker = createStackPicker(() => {});
    picker.setEntries([record('id1', 'Crypt <b>Crawl</b>')]);
    expect(picker.select.querySelector('b')).toBeNull();
    expect(optionsIn(picker, 'My stacks')).toEqual([['id1', 'Crypt <b>Crawl</b>']]);
  });

  it('select(id) selects the right entry option', () => {
    const picker = createStackPicker(() => {});
    picker.setEntries([record('id1', 'A'), record('id2', 'B')]);
    picker.setSelected('id2');
    expect(picker.select.value).toBe('id2');
    expect(picker.select.selectedOptions[0].textContent).toBe('B');
  });
});

