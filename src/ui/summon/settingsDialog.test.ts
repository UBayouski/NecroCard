// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY_STORAGE } from '../../summon/directTransport.js';
import { maskKey, SETTINGS_TEXT, SettingsDialog, type KeyStorage } from './settingsDialog.js';

afterEach(() => {
  document.body.replaceChildren();
});

const KEY = 'AIzaSyExampleKeyabcd';

function memoryStorage(initial: Record<string, string> = {}): KeyStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: k => data[k] ?? null,
    setItem: (k, v) => { data[k] = v; },
    removeItem: k => { delete data[k]; },
  };
}

function setup(
  initial: Record<string, string> = {},
  testKey: (key: string, signal: AbortSignal) => Promise<void> = vi.fn(async () => {}),
) {
  const storage = memoryStorage(initial);
  const onChange = vi.fn();
  const dialog = new SettingsDialog({ storage, testKey, onChange });
  const button = (name: string) =>
    Array.from(dialog.dialog.querySelectorAll('button')).find(b => b.textContent === name)!;
  const text = (sel: string) => dialog.dialog.querySelector(sel)!.textContent;
  return { dialog, storage, onChange, testKey, button, stored: () => text('.settings-stored'), status: () => text('.summon-progress') };
}

describe('SettingsDialog', () => {
  it('a password input without autocomplete, labelled, inside a labelled dialog', () => {
    const { dialog } = setup();
    dialog.open();
    expect(dialog.input.type).toBe('password');
    expect(dialog.input.autocomplete).toBe('off');
    expect(dialog.input.closest('label')?.textContent).toContain('Paste a Gemini API key');
    expect(document.getElementById(dialog.dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Gemini key');
    expect(dialog.dialog.textContent).toContain('sent only to Google');
  });

  it('Save stores the trimmed key under necrocard.geminiKey, clears the input and shows it masked', () => {
    const s = setup();
    s.dialog.open();
    expect(s.stored()).toBe(SETTINGS_TEXT.noKey);
    expect(s.button('Clear').disabled).toBe(true);
    s.dialog.input.value = `  ${KEY}  `;
    s.button('Save').click();
    expect(s.storage.data[KEY_STORAGE]).toBe(KEY);
    expect(s.dialog.input.value).toBe('');
    expect(s.stored()).toBe('Stored key: •••• abcd');
    expect(s.dialog.dialog.innerHTML).not.toContain(KEY);
    expect(s.status()).toBe(SETTINGS_TEXT.saved);
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });

  it('Clear removes the key', () => {
    const s = setup({ [KEY_STORAGE]: KEY });
    s.dialog.open();
    expect(s.stored()).toBe('Stored key: •••• abcd');
    s.button('Clear').click();
    expect(s.storage.data[KEY_STORAGE]).toBeUndefined();
    expect(s.stored()).toBe(SETTINGS_TEXT.noKey);
    expect(s.status()).toBe(SETTINGS_TEXT.cleared);
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });

  it('Save and Test with an empty input ask for a key', async () => {
    const s = setup();
    s.dialog.open();
    s.button('Save').click();
    expect(s.status()).toBe(SETTINGS_TEXT.pasteFirst);
    await s.dialog.test();
    expect(s.testKey).not.toHaveBeenCalled();
    expect(s.storage.data).toEqual({});
  });

  it('Test sends the pasted key and reports success without storing it', async () => {
    const s = setup();
    s.dialog.open();
    s.dialog.input.value = KEY;
    const pending = s.dialog.test();
    expect(s.status()).toBe(SETTINGS_TEXT.testing);
    await pending;
    expect(s.testKey).toHaveBeenCalledWith(KEY, expect.any(AbortSignal));
    expect(s.status()).toBe(SETTINGS_TEXT.works);
    expect(s.storage.data).toEqual({});
  });

  it('Test reports the failure message', async () => {
    const s = setup({}, vi.fn(async () => { throw new Error('Gemini rejected the API key (HTTP 400).'); }));
    s.dialog.open();
    s.dialog.input.value = 'bad';
    await s.dialog.test();
    expect(s.status()).toBe('Gemini rejected the API key (HTTP 400).');
  });

  it('Close aborts a pending test and empties the input', async () => {
    let signal!: AbortSignal;
    const testKey = vi.fn((_k: string, sig: AbortSignal) => {
      signal = sig;
      return new Promise<void>((_r, reject) => sig.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))));
    });
    const s = setup({}, testKey);
    s.dialog.open();
    s.dialog.input.value = KEY;
    const pending = s.dialog.test();
    s.button('Close').click();
    await pending;
    expect(signal.aborted).toBe(true);
    expect(s.dialog.isOpen).toBe(false);
    expect(s.dialog.input.value).toBe('');
  });

  it('maskKey shows at most the last four characters', () => {
    expect(maskKey(KEY)).toBe('•••• abcd');
    expect(maskKey('short')).toBe('••••');
  });
});
