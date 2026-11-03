// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createStackPicker, fixtureFromSearch, FIXTURES, urlWithFixture } from './stackPicker.js';
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
