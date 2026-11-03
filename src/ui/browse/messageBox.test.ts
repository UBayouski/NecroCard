// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { remapLine, runMessageBoxLine, wrapStatement, WRAPPER_HANDLER } from './messageBox.js';
import { BrowseRuntime } from './runtime.js';
import { CardStage } from './stage.js';
import { background, field, makeStack } from './testStacks.js';
import { NecroTalkError } from '../../interp/errors.js';
import type { Stack } from '../../model/types.js';

function setup() {
  const stage = new CardStage();
  document.body.replaceChildren(stage.viewport);
  const messages: string[] = [];
  const status = { show: (m: string) => messages.push(m), clear: () => { messages.length = 0; } };
  const rt = new BrowseRuntime(stage, status, { beep: () => {} });
  return { stage, rt, messages };
}

function threeCards(): Stack {
  return makeStack({
    backgrounds: [background('Main', [field('Banner', { text: 'b' })])],
    cards: [
      { name: 'One', objects: [field('Name', { text: '' })] },
      { name: 'Two', script: 'on openCard\n  global ghost\n  put ghost into field "Banner"\n  put "from handler" into ghost\nend openCard' },
      { name: 'Three' },
    ],
  });
}

describe('wrapStatement / remapLine', () => {
  it('wraps the typed line in a hidden handler', () => {
    expect(wrapStatement('go next')).toEqual({
      source: `on ${WRAPPER_HANDLER}\ngo next\nend ${WRAPPER_HANDLER}`, offset: 1, declarations: 0,
    });
  });

  it('declares every identifier global first (HyperCard message-box variables are global)', () => {
    const w = wrapStatement('put Ghost & n into field "Name"');
    expect(w.source).toBe(`on ${WRAPPER_HANDLER}\nglobal ghost\nglobal n\nput Ghost & n into field "Name"\nend ${WRAPPER_HANDLER}`);
    expect(w.offset).toBe(3);
    expect(w.declarations).toBe(2);
  });

  it('maps wrapped line numbers back to the typed line', () => {
    expect(remapLine('Line 2: No card named "X".', 1)).toBe('Line 1: No card named "X".');
    expect(remapLine('Line 4: Unknown function "foo".', 3)).toBe('Line 1: Unknown function "foo".');
    expect(remapLine('Line 1: oops.', 1)).toBe('Line 1: oops.');
    expect(remapLine('No field named "X"', 1)).toBe('No field named "X"');
  });
});

describe('runMessageBoxLine via the runtime', () => {
  it('go next navigates the current stack', async () => {
    const { rt, stage } = setup();
    await rt.load(threeCards());
    await rt.runMessageBox('go next');
    expect(stage.surface.dataset.cardName).toBe('Two');
    await rt.runMessageBox('go to card "three"');
    expect(stage.surface.dataset.cardIndex).toBe('2');
  });

  it('put into a field updates the card', async () => {
    const { rt, stage } = setup();
    await rt.load(threeCards());
    await rt.runMessageBox('put "Mina" into field "Name"');
    expect(stage.surface.querySelector('[data-object-name="Name"]')!.textContent).toBe('Mina');
    await rt.runMessageBox('put " was here" after field "Banner"');
    expect(stage.surface.querySelector('[data-object-name="Banner"]')!.textContent).toBe('b was here');
  });

  it('errors are prefixed and reported against line 1', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rt, messages } = setup();
    await rt.load(threeCards());
    await rt.runMessageBox('go to card "Nowhere"');
    expect(messages).toEqual(['Message box: Line 1: No card named "Nowhere".']);
    await rt.runMessageBox('hide me');
    expect(messages).toEqual(['Message box: Line 1: "me" is not available here.']);
    await rt.runMessageBox('put field "Nope" into x');
    expect(messages).toEqual(['Message box: No field named "Nope"']);
    expect(rt.isBusy).toBe(false);
  });

  it('globals are shared with handlers in both directions', async () => {
    const { rt, stage } = setup();
    await rt.load(threeCards());
    const text = (n: string) => stage.surface.querySelector(`[data-object-name="${n}"]`)!.textContent;
    // Box writes; card Two's openCard handler (which declares `global ghost`) reads it.
    await rt.runMessageBox('put "Boo" into ghost');
    expect(rt.currentState!.globals.get('ghost')).toBe('Boo');
    await rt.runMessageBox('go next');
    expect(text('Banner')).toBe('Boo');
    // The handler wrote the global; the box reads it.
    await rt.runMessageBox('go first');
    await rt.runMessageBox('put ghost into field "Name"');
    expect(text('Name')).toBe('from handler');
  });
});

describe('runMessageBoxLine directly', () => {
  const host = {
    goToCard: async () => {}, getCurrentCardIndex: () => 0, getCardCount: () => 1, getCardNames: () => ['A'],
    setVisualEffect: async () => {}, answer: async () => 'OK', ask: async () => '',
    showObject: () => {}, hideObject: () => {}, getProperty: () => '', setProperty: () => {},
    getFieldText: () => '', setFieldText: () => {}, beep: vi.fn(), getDate: () => '', getTime: () => '',
    random: () => 1,
  };

  it('runs one statement; empty and comment-only lines do nothing', async () => {
    await runMessageBoxLine('beep', host, new Map());
    expect(host.beep).toHaveBeenCalledTimes(1);
    await runMessageBoxLine('   ', host, new Map());
    await runMessageBoxLine('-- just a comment', host, new Map());
    expect(host.beep).toHaveBeenCalledTimes(1);
  });

  it('writes and reads the shared globals map', async () => {
    const globals = new Map<string, string>([['ghost', 'Boo']]);
    const seen: string[] = [];
    const h = { ...host, setFieldText: (_r: unknown, t: string) => { seen.push(t); } };
    await runMessageBoxLine('put ghost into field "X"', h, globals);
    expect(seen).toEqual(['Boo']);
    await runMessageBoxLine('put 5 into g', host, globals);
    expect(globals.get('g')).toBe('5');
    await runMessageBoxLine('get 7', host, globals);
    expect(globals.has('it')).toBe(false); // `it` stays local
  });

  it('rejects multiple lines and handler structure', async () => {
    await expect(runMessageBoxLine('beep\nbeep', host, new Map())).rejects.toThrow('Line 1: The message box runs one statement.');
    const err = await runMessageBoxLine('on mouseUp', host, new Map()).catch(e => e);
    expect(err).toBeInstanceOf(NecroTalkError);
    expect((err as NecroTalkError).message).toMatch(/^Line [12]: /);
  });

  it('tokenizer errors report line 1', async () => {
    await expect(runMessageBoxLine('put "oops into x', host, new Map())).rejects.toThrow(/^Line 1: /);
  });

  it('runtime errors after global declarations still report line 1', async () => {
    await expect(runMessageBoxLine('put foo(x) into y', host, new Map())).rejects.toThrow('Line 1: Unknown function "foo".');
  });
});

describe('PBT: navigation range through the message box', () => {
  const goStmt = (count: number) => fc.oneof(
    fc.constantFrom('go next', 'go prev', 'go first', 'go last'),
    fc.integer({ min: 0, max: count + 1 }).map(n => `go to card ${n}`),
    fc.integer({ min: 0, max: count }).map(n => `go to card "C${n}"`),
  );

  it('the current card index stays in range and matches data-card-index', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }).chain(count => fc.tuple(fc.constant(count), fc.array(goStmt(count), { maxLength: 8 }))),
        async ([count, stmts]) => {
          const stack = makeStack({ cards: Array.from({ length: count }, (_, i) => ({ name: `C${i}` })) });
          const { rt, stage } = setup();
          await rt.load(stack);
          for (const s of stmts) {
            await rt.runMessageBox(s);
            const idx = rt.currentHost!.getCurrentCardIndex();
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThanOrEqual(count - 1);
            expect(stage.surface.dataset.cardIndex).toBe(String(idx));
            expect(stage.surface.dataset.cardName).toBe(`C${idx}`);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
