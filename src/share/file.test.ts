// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import quiz from '../../fixtures/quiz.necrocard.json' with { type: 'json' };
import { serializeStack } from '../model/serialize.js';
import type { Stack } from '../model/types.js';
import { exportStack, pickStackFile, readStackFile, safeFileName, ShareImportError } from './file.js';

const QUIZ = quiz as unknown as Stack;

describe('safeFileName', () => {
  it.each([
    ['The Haunted Quiz', 'The Haunted Quiz.necrocard.json'],
    ['Crypt/Crawl: v2', 'Crypt-Crawl-v2.necrocard.json'],
    ['  spaced  ', 'spaced.necrocard.json'],
    ['***', 'stack.necrocard.json'],
    ['', 'stack.necrocard.json'],
  ])('%p -> %p', (input, output) => {
    expect(safeFileName(input)).toBe(output);
  });
});

describe('exportStack', () => {
  it('clicks an anchor with the safe download name and a blob URL that holds the canonical JSON', async () => {
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {});
    let captured: Blob | null = null;
    const revoked: string[] = [];
    exportStack(QUIZ, {
      anchor: () => anchor,
      createUrl: blob => { captured = blob; return 'blob:fake-url'; },
      revokeUrl: url => revoked.push(url),
      defer: fn => fn(),
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe('The Haunted Quiz.necrocard.json');
    expect(anchor.getAttribute('href')).toBe('blob:fake-url');
    expect(revoked).toEqual(['blob:fake-url']);
    expect(captured).not.toBeNull();
    expect(JSON.parse(await captured!.text())).toEqual(QUIZ);
    expect(await captured!.text()).toBe(serializeStack(QUIZ));
  });
});

describe('readStackFile', () => {
  const file = (text: string) => new Blob([text], { type: 'application/json' });

  it('parses and validates a good file', async () => {
    expect(await readStackFile(file(serializeStack(QUIZ)))).toEqual(QUIZ);
  });

  it('maps bad JSON and invalid stacks to ShareImportError', async () => {
    const e1 = await readStackFile(file('{oops')).catch(e => e);
    expect(e1).toBeInstanceOf(ShareImportError);
    expect(e1.message).toBe('That file is not valid JSON.');

    const e2 = await readStackFile(file('{"name":"no cards"}')).catch(e => e);
    expect(e2).toBeInstanceOf(ShareImportError);
    expect(e2.message).toMatch(/^That file is not a valid NecroCard stack/);
  });

  it('a read error becomes ShareImportError', async () => {
    const broken = { text: () => Promise.reject(new Error('io')) } as unknown as Blob;
    const e = await readStackFile(broken).catch(err => err);
    expect(e).toBeInstanceOf(ShareImportError);
    expect(e.message).toBe('That file could not be read.');
  });
});

describe('pickStackFile', () => {
  it('resolves with the chosen file', async () => {
    const pending = pickStackFile();
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.accept).toContain('application/json');
    const file = new File(['{}'], 'stack.necrocard.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(await pending).toBe(file);
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('resolves null on cancel', async () => {
    const pending = pickStackFile();
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    input.dispatchEvent(new Event('cancel'));
    expect(await pending).toBeNull();
  });
});
