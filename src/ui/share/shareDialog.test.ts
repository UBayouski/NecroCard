// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import quiz from '../../../fixtures/quiz.necrocard.json' with { type: 'json' };
import { FRAGMENT_PARAM } from '../../share/autosave.js';
import { ShareImportError } from '../../share/file.js';
import type { Stack } from '../../model/types.js';
import { SHARE_TEXT, SHARE_URL_WARN, ShareDialog, type ShareDialogDeps } from './shareDialog.js';

afterEach(() => {
  document.body.replaceChildren();
});

const QUIZ = quiz as unknown as Stack;
const BASE = 'https://necrocard.example/app';

function setup(over: Partial<ShareDialogDeps> = {}) {
  const deps: ShareDialogDeps = {
    currentStack: () => QUIZ,
    onImported: vi.fn(async () => {}),
    encode: vi.fn(async () => 'ENCODED'),
    clipboard: { writeText: vi.fn(async () => {}) },
    exportStack: vi.fn(),
    pickFile: vi.fn(async () => null),
    read: vi.fn(async () => QUIZ),
    baseUrl: () => BASE,
    ...over,
  };
  const dialog = new ShareDialog(deps);
  const q = <T extends Element>(sel: string) => dialog.dialog.querySelector<T>(sel)!;
  const button = (name: string) => Array.from(dialog.dialog.querySelectorAll('button')).find(b => b.textContent === name)!;
  return {
    dialog, deps,
    url: () => dialog.urlInput.value,
    length: () => q<HTMLElement>('.share-length').textContent,
    warning: () => q<HTMLElement>('.share-warning'),
    status: () => q<HTMLElement>('.summon-progress').textContent,
    copy: () => button('Copy'),
    button,
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('ShareDialog', () => {
  it('shows origin+pathname + #s=<encoded> with no query, and the length', async () => {
    const s = setup();
    s.dialog.open();
    expect(s.url()).toBe(SHARE_TEXT.building);
    expect(s.copy().disabled).toBe(true);
    await flush();
    expect(s.url()).toBe(`${BASE}#${FRAGMENT_PARAM}=ENCODED`);
    expect(s.url()).not.toContain('?');
    expect(s.length()).toBe(`${s.url().length} characters`);
    expect(s.copy().disabled).toBe(false);
    expect(s.warning().hidden).toBe(true);
  });

  it('shows the warning only past the threshold', async () => {
    const s = setup({ encode: async () => 'E'.repeat(SHARE_URL_WARN) });
    s.dialog.open();
    await flush();
    expect(s.url().length).toBeGreaterThan(SHARE_URL_WARN);
    expect(s.warning().hidden).toBe(false);
    expect(s.warning().textContent).toBe(SHARE_TEXT.warning);
  });

  it('an encode failure clears the input and shows a message', async () => {
    const s = setup({ encode: async () => { throw new Error('no CompressionStream'); } });
    s.dialog.open();
    await flush();
    expect(s.url()).toBe('');
    expect(s.status()).toBe(SHARE_TEXT.encodeFailed);
  });

  it('Copy uses the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    const s = setup({ clipboard: { writeText } });
    s.dialog.open();
    await flush();
    s.copy().click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${BASE}#${FRAGMENT_PARAM}=ENCODED`);
    expect(s.status()).toBe(SHARE_TEXT.copied);
  });

  it('Copy falls back to execCommand when the clipboard rejects', async () => {
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    const s = setup({ clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    s.dialog.open();
    await flush();
    s.copy().click();
    await flush();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(s.status()).toBe(SHARE_TEXT.copied);
  });

  it('Copy shows the manual prompt when execCommand also fails', async () => {
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => false);
    const s = setup({ clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    s.dialog.open();
    await flush();
    s.copy().click();
    await flush();
    expect(s.status()).toBe(SHARE_TEXT.copyManual);
  });

  it('Export calls the dep with the current stack', async () => {
    const s = setup();
    s.dialog.open();
    await flush();
    s.button('Export').click();
    expect(s.deps.exportStack).toHaveBeenCalledWith(QUIZ);
  });

  it('Import loads the chosen file and closes', async () => {
    const file = new File(['{}'], 'a.necrocard.json');
    const s = setup({ pickFile: async () => file, read: async () => QUIZ });
    s.dialog.open();
    await flush();
    s.button('Import').click();
    await flush();
    expect(s.deps.onImported).toHaveBeenCalledWith(QUIZ);
    expect(s.dialog.isOpen).toBe(false);
  });

  it('a bad import file shows its message and keeps the dialog open', async () => {
    const file = new File(['{}'], 'a.necrocard.json');
    const s = setup({ pickFile: async () => file, read: async () => { throw new ShareImportError('That file is not valid JSON.'); } });
    s.dialog.open();
    await flush();
    s.button('Import').click();
    await flush();
    expect(s.status()).toBe('That file is not valid JSON.');
    expect(s.dialog.isOpen).toBe(true);
    expect(s.deps.onImported).not.toHaveBeenCalled();
  });

  it('Import cancelled does nothing', async () => {
    const s = setup({ pickFile: async () => null });
    s.dialog.open();
    await flush();
    s.button('Import').click();
    await flush();
    expect(s.deps.onImported).not.toHaveBeenCalled();
    expect(s.dialog.isOpen).toBe(true);
  });

  it('Escape closes', async () => {
    const s = setup();
    s.dialog.open();
    await flush();
    s.dialog.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(s.dialog.isOpen).toBe(false);
  });
});
