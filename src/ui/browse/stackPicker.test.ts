// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createStackPicker, CUSTOM, fixtureFromSearch, FIXTURES, UNTITLED, urlWithFixture } from './stackPicker.js';
import { loadFixture } from '../../model/fixtures.js';

describe('stack picker', () => {
  it('lists the three fixtures in order, labelled by stack name', () => {
    const picker = createStackPicker(() => {});
    const options = Array.from(picker.select.options).map(o => [o.value, o.textContent]);
    expect(options).toEqual([
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

  it('reports changes and can be disabled', () => {
    const onChange = vi.fn();
    const picker = createStackPicker(onChange);
    picker.setValue('flashcards');
    picker.select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('flashcards');
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

describe('stack picker: Untitled entry (edit-mode REQ-1.5)', () => {
  it('showUntitled adds and selects one Untitled option; choosing a fixture removes it', () => {
    const onChange = vi.fn();
    const picker = createStackPicker(onChange);
    picker.showUntitled();
    picker.showUntitled();
    const values = () => Array.from(picker.select.options).map(o => o.value);
    expect(values()).toEqual(['quiz', 'adventure', 'flashcards', UNTITLED]);
    expect(picker.select.value).toBe(UNTITLED);
    expect(picker.select.selectedOptions[0].textContent).toBe('Untitled');
    picker.select.dispatchEvent(new Event('change'));
    expect(onChange).not.toHaveBeenCalled(); // re-selecting Untitled loads nothing
    picker.setValue('adventure');
    expect(values()).toEqual(['quiz', 'adventure', 'flashcards']);
  });
});

describe('stack picker: summoned entry (summon REQ-8.3)', () => {
  const values = (picker: ReturnType<typeof createStackPicker>) => Array.from(picker.select.options).map(o => o.value);

  it('showCustom adds one entry with the stack name, renames it on the next summon, and selects it', () => {
    const onChange = vi.fn();
    const picker = createStackPicker(onChange);
    picker.showCustom('Ghost Quiz');
    expect(values(picker)).toEqual(['quiz', 'adventure', 'flashcards', CUSTOM]);
    expect(picker.select.selectedOptions[0].textContent).toBe('Ghost Quiz');
    picker.showCustom('Crypt <b>Crawl</b>');
    expect(values(picker)).toEqual(['quiz', 'adventure', 'flashcards', CUSTOM]);
    expect(picker.select.selectedOptions[0].textContent).toBe('Crypt <b>Crawl</b>');
    expect(picker.select.querySelector('b')).toBeNull();
    picker.select.dispatchEvent(new Event('change'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an empty name reads "Summoned stack"', () => {
    const picker = createStackPicker(() => {});
    picker.showCustom('  ');
    expect(picker.select.selectedOptions[0].textContent).toBe('Summoned stack');
  });

  it('choosing a fixture or New Stack removes it; New Stack and Summon replace each other', () => {
    const picker = createStackPicker(() => {});
    picker.showCustom('A');
    picker.setValue('quiz');
    expect(values(picker)).toEqual(['quiz', 'adventure', 'flashcards']);
    picker.showCustom('A');
    picker.showUntitled();
    expect(values(picker)).toEqual(['quiz', 'adventure', 'flashcards', UNTITLED]);
    picker.showCustom('B');
    expect(values(picker)).toEqual(['quiz', 'adventure', 'flashcards', CUSTOM]);
    picker.setValue(CUSTOM);
    expect(picker.select.value).toBe(CUSTOM);
  });
});
