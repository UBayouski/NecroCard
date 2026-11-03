import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { evaluate } from './evaluator.js';
import type { HostInterface } from './evaluator.js';
import { parse } from './parser.js';
import { NecroTalkError } from './errors.js';
import type { ObjectRef } from './ast.js';

// ---------------------------------------------------------------------------
// Mock host
// ---------------------------------------------------------------------------

class MockHost implements HostInterface {
  cardIndex = 0;
  cardCount = 5;
  cardNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  fields = new Map<string, string>();
  properties = new Map<string, string>();
  visibleObjects = new Set<string>();
  goToCardCalls: number[] = [];
  beepCount = 0;
  answerResponse = 'OK';
  askResponse = '';
  visualEffects: string[] = [];

  goToCard(index: number): Promise<void> {
    this.goToCardCalls.push(index);
    this.cardIndex = index;
    return Promise.resolve();
  }
  getCurrentCardIndex() { return this.cardIndex; }
  getCardCount() { return this.cardCount; }
  getCardNames() { return this.cardNames; }
  setVisualEffect(effect: string): Promise<void> {
    this.visualEffects.push(effect);
    return Promise.resolve();
  }
  answer(_prompt: string, _buttons: string[]): Promise<string> {
    return Promise.resolve(this.answerResponse);
  }
  ask(_prompt: string, _def: string): Promise<string> {
    return Promise.resolve(this.askResponse);
  }
  showObject(ref: ObjectRef) { this.visibleObjects.add(JSON.stringify(ref)); }
  hideObject(ref: ObjectRef) { this.visibleObjects.delete(JSON.stringify(ref)); }
  getProperty(_ref: ObjectRef, prop: string) { return this.properties.get(prop) ?? ''; }
  setProperty(_ref: ObjectRef, prop: string, value: string) { this.properties.set(prop, value); }
  getFieldText(ref: ObjectRef) {
    const key = ref.name && ref.name.kind === 'literal' ? String(ref.name.value) : JSON.stringify(ref);
    return this.fields.get(key) ?? '';
  }
  setFieldText(ref: ObjectRef, text: string) {
    const key = ref.name && ref.name.kind === 'literal' ? String(ref.name.value) : JSON.stringify(ref);
    this.fields.set(key, text);
  }
  beep() { this.beepCount++; }
  getDate() { return '2026-11-03'; }
  getTime() { return '14:00:00'; }
  random(n: number) { return Math.floor(Math.random() * n) + 1; }
}

function run(src: string, handlerName = 'h', host?: MockHost): Promise<{ host: MockHost; globals: Map<string, string> }> {
  const h = host ?? new MockHost();
  const globals = new Map<string, string>();
  const script = parse(src);
  return evaluate(script, handlerName, [], h, globals).then(() => ({ host: h, globals }));
}

// ---------------------------------------------------------------------------
// Task 9: Evaluator skeleton
// ---------------------------------------------------------------------------

describe('evaluator — skeleton', () => {
  it('evaluates a handler with beep', async () => {
    const { host } = await run('on h\n  beep\nend h');
    expect(host.beepCount).toBe(1);
  });

  it('returns silently when handler not found', async () => {
    const { host } = await run('on h\n  beep\nend h', 'missing');
    expect(host.beepCount).toBe(0);
  });

  it('get 42 sets it to "42"', async () => {
    // Read `it` back through a field the mock host records
    const { host } = await run('on h\n  get 42\n  put it into field "Out"\nend h');
    expect(host.fields.get('Out')).toBe('42');
  });

  it('case-insensitive handler lookup', async () => {
    const { host } = await run('on mouseUp\n  beep\nend mouseUp', 'MOUSEUP');
    expect(host.beepCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 10: Control flow
// ---------------------------------------------------------------------------

describe('evaluator — control flow', () => {
  it('if true then beep', async () => {
    const { host } = await run('on h\n  if true then beep\nend h');
    expect(host.beepCount).toBe(1);
  });

  it('if false then beep — not called', async () => {
    const { host } = await run('on h\n  if false then beep\nend h');
    expect(host.beepCount).toBe(0);
  });

  it('if/else if chooses correct branch', async () => {
    const src = `on h
  put 2 into x
  if x = 1 then
    beep
  else if x = 2 then
    beep
    beep
  end if
end h`;
    const { host } = await run(src);
    expect(host.beepCount).toBe(2);
  });

  it('repeat 3 times executes body 3 times', async () => {
    const { host } = await run('on h\n  repeat 3 times\n    beep\n  end repeat\nend h');
    expect(host.beepCount).toBe(3);
  });

  it('repeat with i = 1 to 5 increments counter', async () => {
    const src = `on h
  put 0 into total
  repeat with i = 1 to 5
    put total + i into total
  end repeat
  put total into field "Result"
end h`;
    const { host } = await run(src);
    expect(host.fields.get('Result')).toBe('15');
  });

  it('repeat while exits when condition false', async () => {
    const src = `on h
  put 3 into n
  repeat while n > 0
    beep
    put n - 1 into n
  end repeat
end h`;
    const { host } = await run(src);
    expect(host.beepCount).toBe(3);
  });

  it('exit repeat breaks loop', async () => {
    const src = `on h
  repeat 10 times
    beep
    exit repeat
  end repeat
end h`;
    const { host } = await run(src);
    expect(host.beepCount).toBe(1);
  });

  it('next repeat skips to next iteration', async () => {
    const src = `on h
  repeat with i = 1 to 5
    if i = 3 then next repeat
    beep
  end repeat
end h`;
    const { host } = await run(src);
    expect(host.beepCount).toBe(4);
  });

  it('exit handler stops execution', async () => {
    const src = `on h
  beep
  exit h
  beep
end h`;
    const { host } = await run(src);
    expect(host.beepCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 11: Expressions
// ---------------------------------------------------------------------------

describe('evaluator — expressions', () => {
  async function getVal(exprSrc: string): Promise<string> {
    const src = `on h\n  put ${exprSrc} into field "Out"\nend h`;
    const { host } = await run(src);
    return host.fields.get('Out') ?? '';
  }

  it('1 + 2 * 3 = 7', async () => {
    expect(await getVal('1 + 2 * 3')).toBe('7');
  });

  it('"a" & "b" = "ab"', async () => {
    expect(await getVal('"a" & "b"')).toBe('ab');
  });

  it('"a" && "b" = "a b"', async () => {
    expect(await getVal('"a" && "b"')).toBe('a b');
  });

  it('5 > 3 = "true"', async () => {
    expect(await getVal('5 > 3')).toBe('true');
  });

  it('"abc" contains "b" = "true"', async () => {
    expect(await getVal('"abc" contains "b"')).toBe('true');
  });

  it('not true = "false"', async () => {
    expect(await getVal('not true')).toBe('false');
  });

  it('word 2 of "hello world" = "world"', async () => {
    expect(await getVal('word 2 of "hello world"')).toBe('world');
  });

  it('char 3 of "abc" = "c"', async () => {
    expect(await getVal('char 3 of "abc"')).toBe('c');
  });

  it('arithmetic on non-number throws NecroTalkError', async () => {
    await expect(run('on h\n  put "abc" + 1 into it\nend h')).rejects.toThrow(NecroTalkError);
  });

  it('unset variable evaluates to its own name', async () => {
    expect(await getVal('foo')).toBe('foo');
  });

  it('the number of cards calls host.getCardCount()', async () => {
    const host = new MockHost();
    host.cardCount = 7;
    const { host: h } = await run('on h\n  put the number of cards into field "Out"\nend h', 'h', host);
    expect(h.fields.get('Out')).toBe('7');
  });

  it('the number of words of "a b c" = 3', async () => {
    expect(await getVal('the number of words of "a b c"')).toBe('3');
  });

  it('is not operator', async () => {
    expect(await getVal('1 is not 2')).toBe('true');
    expect(await getVal('1 is not 1')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Task 12: Remaining statements
// ---------------------------------------------------------------------------

describe('evaluator — remaining statements', () => {
  it('go next calls host.goToCard with resolved index', async () => {
    const { host } = await run('on h\n  go next\nend h');
    expect(host.goToCardCalls).toEqual([1]);
  });

  it('visual effect calls host.setVisualEffect', async () => {
    const { host } = await run('on h\n  visual effect dissolve\nend h');
    expect(host.visualEffects).toEqual(['dissolve']);
  });

  it('put before concatenates correctly', async () => {
    const src = `on h
  put "world" into field "Out"
  put "hello " before field "Out"
end h`;
    const { host } = await run(src);
    expect(host.fields.get('Out')).toBe('hello world');
  });

  it('set property calls host.setProperty', async () => {
    const { host } = await run('on h\n  set visible of button "OK" to "true"\nend h');
    expect(host.properties.get('visible')).toBe('true');
  });

  it('global declares variable in globals map', async () => {
    const src = `on h
  global score
  put 42 into score
end h`;
    const host = new MockHost();
    const globals = new Map<string, string>();
    const script = parse(src);
    await evaluate(script, 'h', [], host, globals);
    expect(globals.get('score')).toBe('42');
  });

  it('answer stores result in it', async () => {
    const host = new MockHost();
    host.answerResponse = 'Yes';
    await run('on h\n  answer "Sure?" with "Yes" or "No"\n  put it into field "Result"\nend h', 'h', host);
    expect(host.fields.get('Result')).toBe('Yes');
  });

  it('ask stores result in it', async () => {
    const host = new MockHost();
    host.askResponse = 'Alice';
    await run('on h\n  ask "Name?"\n  put it into field "Result"\nend h', 'h', host);
    expect(host.fields.get('Result')).toBe('Alice');
  });

  it('show/hide call host methods', async () => {
    const host = new MockHost();
    await run('on h\n  show field "Answer"\nend h', 'h', host);
    expect(host.visibleObjects.size).toBeGreaterThan(0);
  });

  it('execution budget: infinite loop throws NecroTalkError with "ran too long"', async () => {
    const src = `on h
  repeat while true
    beep
  end repeat
end h`;
    await expect(run(src)).rejects.toThrow(/ran too long/i);
  });
});

// ---------------------------------------------------------------------------
// Task 13 is tested via messageQueue.test.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Task 14: PBT put/read invariant
// ---------------------------------------------------------------------------

describe('PBT — put/read invariant', () => {
  it('put <value> into it then read it returns the same value (200 runs)', async () => {
    // Generate strings without ", \n, \r (NecroTalk has no escape sequences)
    const safeStr = fc.string({ unit: 'grapheme' }).filter(
      s => !s.includes('"') && !s.includes('\n') && !s.includes('\r')
    );

    await fc.assert(
      fc.asyncProperty(safeStr, async (value) => {
        // Read `it` back by putting it into a field the mock host records
        const src = `on test\n  put "${value}" into it\n  put it into field "Result"\nend test`;
        const host = new MockHost();
        await evaluate(parse(src), 'test', [], host, new Map());
        expect(host.fields.get('Result')).toBe(value);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 15 is covered in navigation.test.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Task 16: Integration tests
// ---------------------------------------------------------------------------

describe('integration', () => {
  it('counter loop accumulates correctly', async () => {
    const src = `on h
  put 0 into sum
  repeat with i = 1 to 10
    put sum + i into sum
  end repeat
  put sum into field "Total"
end h`;
    const { host } = await run(src);
    expect(host.fields.get('Total')).toBe('55');
  });

  it('if/else if/else shows correct field', async () => {
    const src = `on h
  put 2 into x
  if x = 1 then
    show field "A"
  else if x = 2 then
    show field "B"
  else
    show field "C"
  end if
end h`;
    const host = new MockHost();
    await run(src, 'h', host);
    const shown = [...host.visibleObjects];
    expect(shown.some(s => s.includes('"B"'))).toBe(true);
  });

  it('variable case-insensitivity: put into MyVar, get from myvar', async () => {
    const src = `on h
  put "hello" into MyVar
  put myvar into field "Out"
end h`;
    const { host } = await run(src);
    expect(host.fields.get('Out')).toBe('hello');
  });

  it('global variables shared across script', async () => {
    const src = `on h
  global counter
  put 10 into counter
end h`;
    const host = new MockHost();
    const globals = new Map<string, string>();
    const script = parse(src);
    await evaluate(script, 'h', [], host, globals);
    expect(globals.get('counter')).toBe('10');
  });
});
