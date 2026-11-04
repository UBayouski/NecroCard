// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import quiz from '../../../fixtures/quiz.necrocard.json' with { type: 'json' };
import type { Stack } from '../../model/types.js';
import { SummonError, type SummonOptions } from '../../summon/pipeline.js';
import { TransportError, type Transport } from '../../summon/transport.js';
import type { WakeState, WakeStatus } from '../../summon/wake.js';
import { EXAMPLE_PROMPTS, PATH_TEXT, PROGRESS_TEXT, SummonDialog, type SummonDialogDeps } from './summonDialog.js';

afterEach(() => {
  document.body.replaceChildren();
});

const STACK = quiz as unknown as Stack;
const transport = (path: 'server' | 'direct'): Transport => ({ path, send: vi.fn() });

function fakeWake(status: WakeStatus = 'awake', remainingDay?: number) {
  let settle = () => {};
  const settled = new Promise<void>(resolve => { settle = resolve; });
  const wake = {
    status, remainingDay,
    start: vi.fn(),
    whenSettled: () => settled,
    settle: (next: WakeStatus) => { wake.status = next; settle(); },
  };
  return wake as typeof wake & Pick<WakeState, 'status' | 'remainingDay' | 'start' | 'whenSettled'>;
}

/** A summon function the test drives step by step. */
function controlledSummon() {
  let resolve!: (s: Stack) => void;
  let reject!: (e: unknown) => void;
  let options!: SummonOptions;
  const fn = vi.fn((_prompt: string, _t: Transport, o: SummonOptions) => {
    options = o;
    return new Promise<Stack>((res, rej) => {
      resolve = res;
      reject = rej;
      o.signal?.addEventListener('abort', () => rej(new DOMException('cancelled', 'AbortError')));
    });
  });
  return { fn, resolve: (s: Stack) => resolve(s), reject: (e: unknown) => reject(e), options: () => options };
}

function setup(over: Partial<SummonDialogDeps> & { path?: 'server' | 'direct' } = {}) {
  const current = { t: transport(over.path ?? 'server') };
  const summon = controlledSummon();
  const deps: SummonDialogDeps = {
    transport: () => current.t,
    wake: fakeWake(),
    onLoaded: vi.fn(async () => {}),
    onBusyChange: vi.fn(),
    summon: summon.fn,
    ...over,
  };
  const dialog = new SummonDialog(deps);
  const q = <T extends Element>(sel: string) => dialog.dialog.querySelector<T>(sel)!;
  const parts = {
    progress: () => q<HTMLElement>('.summon-progress').textContent,
    error: () => q<HTMLElement>('.summon-error'),
    path: () => q<HTMLElement>('.summon-path').textContent,
    remaining: () => q<HTMLElement>('.summon-remaining'),
    go: () => q<HTMLButtonElement>('.summon-go'),
    cancel: () => q<HTMLButtonElement>('.summon-cancel'),
    examples: () => Array.from(dialog.dialog.querySelectorAll<HTMLButtonElement>('.summon-example')),
  };
  return { dialog, deps, summon, current, ...parts };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('SummonDialog', () => {
  it('is a labelled modal dialog with a labelled textarea and three examples that fill it', () => {
    const { dialog, examples } = setup();
    dialog.open();
    expect(dialog.isOpen).toBe(true);
    expect(document.body.contains(dialog.dialog)).toBe(true);
    const titleId = dialog.dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(titleId)?.textContent).toBe('Summon a stack');
    expect(dialog.textarea.closest('label')?.textContent).toContain('Describe your stack');
    expect(dialog.textarea.maxLength).toBe(2000);
    expect(examples().map(b => b.textContent)).toEqual([...EXAMPLE_PROMPTS]);
    examples()[1].click();
    expect(dialog.textarea.value).toBe(EXAMPLE_PROMPTS[1]);
  });

  it('shows the active path and, for the server, the remaining count from the health check', () => {
    const server = setup({ wake: fakeWake('awake', 42) });
    server.dialog.open();
    expect(server.path()).toBe(`${PATH_TEXT.server} · Requests left today: 42`);
    expect(server.deps.wake.start).toHaveBeenCalled();

    const direct = setup({ path: 'direct', wake: fakeWake('idle', 42) });
    direct.dialog.open();
    expect(direct.path()).toBe(PATH_TEXT.direct);
    expect(direct.remaining().hidden).toBe(true);
    expect(direct.deps.wake.start).not.toHaveBeenCalled();
  });

  it('progress: Waking the server… until health settles, then Summoning…, Validating…, Retrying…', async () => {
    const wake = fakeWake('waking');
    const s = setup({ wake });
    s.dialog.open();
    s.dialog.textarea.value = 'a two-card quiz';
    const run = s.dialog.run();
    expect(s.summon.fn).toHaveBeenCalledWith('a two-card quiz', s.current.t, expect.any(Object));
    s.summon.options().onProgress?.('summoning');
    expect(s.progress()).toBe(PROGRESS_TEXT.waking);
    wake.settle('awake');
    await flush();
    expect(s.progress()).toBe(PROGRESS_TEXT.summoning);
    s.summon.options().onProgress?.('validating');
    expect(s.progress()).toBe(PROGRESS_TEXT.validating);
    s.summon.options().onProgress?.('retrying');
    expect(s.progress()).toBe(PROGRESS_TEXT.retrying);
    s.summon.options().onReply?.({ text: '', remaining: { day: 7, ip: 3 } });
    expect(s.path()).toContain('Requests left today: 7');
    s.summon.resolve(STACK);
    await run;
  });

  it('disables the inputs while pending and reports busy; success loads, clears and closes', async () => {
    const s = setup();
    s.dialog.open();
    s.dialog.textarea.value = 'x';
    const run = s.dialog.run();
    expect(s.dialog.isPending).toBe(true);
    expect([s.dialog.textarea.disabled, s.go().disabled, s.examples()[0].disabled]).toEqual([true, true, true]);
    expect(s.cancel().textContent).toBe('Cancel');
    expect(s.deps.onBusyChange).toHaveBeenLastCalledWith(true);
    s.summon.resolve(STACK);
    await run;
    expect(s.deps.onLoaded).toHaveBeenCalledWith(STACK);
    expect(s.dialog.isOpen).toBe(false);
    expect(s.dialog.textarea.value).toBe('');
    expect(s.dialog.textarea.disabled).toBe(false);
    expect(s.deps.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('a SummonError lists every failure as text, keeps the prompt and stays open', async () => {
    const s = setup();
    s.dialog.open();
    s.dialog.textarea.value = 'a quiz';
    const run = s.dialog.run();
    s.summon.reject(new SummonError(['Schema: (root) bad', 'Script of button "<b>x</b>" on card "A": Line 2: oops.']));
    await run;
    const items = Array.from(s.error().querySelectorAll('li')).map(li => li.textContent);
    expect(items).toEqual(['Schema: (root) bad', 'Script of button "<b>x</b>" on card "A": Line 2: oops.']);
    expect(s.error().querySelector('b')).toBeNull();
    expect(s.error().getAttribute('role')).toBe('alert');
    expect(s.dialog.textarea.value).toBe('a quiz');
    expect(s.dialog.isOpen).toBe(true);
  });

  it('a transport error shows its one message and the counts it carried', async () => {
    const s = setup();
    s.dialog.open();
    s.dialog.textarea.value = 'x';
    const run = s.dialog.run();
    s.summon.reject(new TransportError('cap', 'The daily Summon limit is used up.', { day: 0, ip: 4 }));
    await run;
    expect(s.error().textContent).toBe('The daily Summon limit is used up.');
    expect(s.path()).toContain('Requests left today: 0');
  });

  it('Cancel aborts a pending summon without an error; then Close closes', async () => {
    const s = setup();
    s.dialog.open();
    s.dialog.textarea.value = 'x';
    const run = s.dialog.run();
    const signal = s.summon.options().signal!;
    s.cancel().click();
    await run;
    expect(signal.aborted).toBe(true);
    expect(s.error().textContent).toBe('');
    expect(s.dialog.isOpen).toBe(true);
    expect(s.cancel().textContent).toBe('Close');
    s.cancel().click();
    expect(s.dialog.isOpen).toBe(false);
  });

  it('Escape closes when idle', () => {
    const s = setup();
    s.dialog.open();
    s.dialog.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(s.dialog.isOpen).toBe(false);
  });

  it('an empty prompt asks for a description without summoning', async () => {
    const s = setup();
    s.dialog.open();
    s.dialog.textarea.value = '   ';
    await s.dialog.run();
    expect(s.summon.fn).not.toHaveBeenCalled();
    expect(s.error().textContent).toBe('Describe the stack you want first.');
  });

  it('a failing load is reported and the dialog stays open', async () => {
    const s = setup({ onLoaded: async () => { throw new Error('A script is still running.'); } });
    s.dialog.open();
    s.dialog.textarea.value = 'x';
    const run = s.dialog.run();
    s.summon.resolve(STACK);
    await run;
    expect(s.error().textContent).toBe('Summon failed: A script is still running.');
    expect(s.dialog.isOpen).toBe(true);
  });

  it('picks the transport on every summon', async () => {
    const s = setup();
    s.dialog.open();
    s.dialog.textarea.value = 'x';
    s.current.t = transport('direct');
    const run = s.dialog.run();
    expect(s.summon.fn.mock.calls[0][1].path).toBe('direct');
    expect(s.path()).toBe(PATH_TEXT.direct);
    s.summon.resolve(STACK);
    await run;
  });
});
