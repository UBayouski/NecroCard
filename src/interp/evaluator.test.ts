import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { evaluate } from './evaluator.js';
import type { HostInterface, ResolvedObjectRef, EvaluateOptions } from './evaluator.js';
import { parse } from './parser.js';
import { NecroTalkError } from './errors.js';

// ---------------------------------------------------------------------------
// Mock host
// ---------------------------------------------------------------------------

class MockHost implements HostInterface {
  cardIndex = 0;
  cardCount = 5;
  cardNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  /** Field text keyed by field name. */
  fields = new Map<string, string>();
  properties = new Map<string, string>();
  visibleObjects = new Set<string>();
  /** Every ref passed to show/hide/getProperty/setProperty, in call order. */
  refCalls: { method: string; ref: ResolvedObjectRef }[] = [];
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
  showObject(ref: ResolvedObjectRef) {
    this.refCalls.push({ method: 'show', ref });
    this.visibleObjects.add(JSON.stringify(ref));
  }
  hideObject(ref: ResolvedObjectRef) {
    this.refCalls.push({ method: 'hide', ref });
    this.visibleObjects.delete(JSON.stringify(ref));
  }
  getProperty(ref: ResolvedObjectRef, prop: string) {
    this.refCalls.push({ method: 'getProperty', ref });
    return this.properties.get(prop) ?? '';
  }
  setProperty(ref: ResolvedObjectRef, prop: string, value: string) {
    this.refCalls.push({ method: 'setProperty', ref });
    this.properties.set(prop, value);
  }
  getFieldText(ref: ResolvedObjectRef) { return this.fields.get(ref.name) ?? ''; }
  setFieldText(ref: ResolvedObjectRef, text: string) { this.fields.set(ref.name, text); }
  beep() { this.beepCount++; }
  getDate() { return '2026-11-03'; }
  getTime() { return '14:00:00'; }
  random(n: number) { return Math.floor(Math.random() * n) + 1; }
}

function run(
  src: string,
  handlerName = 'h',
  host?: MockHost,
  options?: EvaluateOptions,
): Promise<{ host: MockHost; globals: Map<string, string> }> {
  const h = host ?? new MockHost();
  const globals = new Map<string, string>();
  const script = parse(src);
  return evaluate(script, handlerName, [], h, globals, options).then(() => ({ host: h, globals }));
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

// ---------------------------------------------------------------------------
// Regression: necrotalk-reviewer findings
// ---------------------------------------------------------------------------

describe('regression — custom handler calls', () => {
  it('calls a handler in the same script with args', async () => {
    const src = `on mouseUp
  addScore 10, 5
end mouseUp
on addScore a, b
  put a + b into field "Score"
end addScore`;
    const { host } = await run(src, 'mouseUp');
    expect(host.fields.get('Score')).toBe('15');
  });

  it('called handler has its own locals but shares globals', async () => {
    const src = `on h
  global total
  put 1 into total
  put "outer" into x
  bump
  put x & "," & total into field "Out"
end h
on bump
  global total
  put total + 1 into total
  put "inner" into x
end bump`;
    const { host } = await run(src);
    expect(host.fields.get('Out')).toBe('outer,2');
  });

  it('exit inside a called handler returns to the caller', async () => {
    const src = `on h
  helper
  beep
end h
on helper
  beep
  exit helper
  beep
end helper`;
    const { host } = await run(src);
    expect(host.beepCount).toBe(2);
  });

  it('unknown handler throws Unknown command with the line', async () => {
    await expect(run('on h\n  beep\n  missingThing 1\nend h'))
      .rejects.toThrow('Line 3: Unknown command "missingThing".');
  });

  it('runaway recursion is stopped with a NecroTalkError', async () => {
    await expect(run('on h\n  h\nend h')).rejects.toThrow(NecroTalkError);
  });
});

describe('regression — misplaced exit / next / pass raise NecroTalkError', () => {
  it('pass with a different handler name', async () => {
    await expect(run('on h\n  beep\n  pass mouseUp\nend h'))
      .rejects.toThrow('Line 3: "pass mouseUp" does not match the running handler "h".');
  });

  it('exit repeat outside a loop', async () => {
    await expect(run('on h\n  exit repeat\nend h'))
      .rejects.toThrow('Line 2: "exit repeat" can only be used inside a repeat loop.');
  });

  it('next repeat outside a loop', async () => {
    await expect(run('on h\n  if true then next repeat\nend h'))
      .rejects.toThrow('Line 2: "next repeat" can only be used inside a repeat loop.');
  });

  it('exit with a different handler name', async () => {
    await expect(run('on h\n  exit other\nend h'))
      .rejects.toThrow('Line 2: "exit other" does not match the running handler "h".');
  });

  it('exit repeat inside a loop still works after a nested if', async () => {
    const { host } = await run('on h\n  repeat 5 times\n    beep\n    if true then exit repeat\n  end repeat\nend h');
    expect(host.beepCount).toBe(1);
  });

  it('errors are NecroTalkError instances, not internal exceptions', async () => {
    try {
      await run('on h\n  next repeat\nend h');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NecroTalkError);
      expect((e as NecroTalkError).line).toBe(2);
    }
  });
});

describe('regression — internal-error messages expose no AST names', () => {
  it('unsupported statement', async () => {
    const script = parse('on h\n  beep\nend h');
    // Simulate an AST node the evaluator does not support (e.g. a future Phase 2 node)
    (script.handlers[0].body as unknown[]).push({ kind: 'play', line: 3 });
    await expect(evaluate(script, 'h', [], new MockHost(), new Map()))
      .rejects.toThrow('Line 3: Internal error, unsupported statement.');
  });

  it('unsupported expression', async () => {
    const script = parse('on h\n  put 1 into it\nend h');
    const put = script.handlers[0].body[0] as { value: unknown };
    put.value = { kind: 'itemChunk' };
    await expect(evaluate(script, 'h', [], new MockHost(), new Map()))
      .rejects.toThrow('Line 2: Internal error, unsupported expression.');
  });
});

describe('runtime errors for unknown functions and properties', () => {
  it('unknown function', async () => {
    await expect(run('on h\n  put foo(1) into it\nend h'))
      .rejects.toThrow('Line 2: Unknown function "foo".');
  });

  it('bare the <name> other than date/time', async () => {
    await expect(run('on h\n  put the target into it\nend h'))
      .rejects.toThrow('Line 2: Unknown property "target".');
  });

  it('the date and the time still work', async () => {
    const { host } = await run('on h\n  put the date && the time into field "Out"\nend h');
    expect(host.fields.get('Out')).toBe('2026-11-03 14:00:00');
  });

  it('the <property> of <object> goes to the host even for "date"', async () => {
    const host = new MockHost();
    host.properties.set('date', 'from-host');
    await run('on h\n  put the date of button "X" into field "Out"\nend h', 'h', host);
    expect(host.fields.get('Out')).toBe('from-host');
  });
});

// ---------------------------------------------------------------------------
// Regression: second necrotalk-reviewer pass
// ---------------------------------------------------------------------------

describe('regression — field reads', () => {
  it('put field "Score" + 1 into field "Score" increments the field', async () => {
    const host = new MockHost();
    host.fields.set('Score', '41');
    await run('on h\n  put field "Score" + 1 into field "Score"\nend h', 'h', host);
    expect(host.fields.get('Score')).toBe('42');
  });

  it('field names can be computed', async () => {
    const host = new MockHost();
    host.fields.set('Q2', 'Boo');
    await run('on h\n  put 2 into n\n  put field ("Q" & n) into field "Out"\nend h', 'h', host);
    expect(host.fields.get('Out')).toBe('Boo');
  });
});

describe('regression — set the <property>', () => {
  it('set the visible of button x resolves the name and calls setProperty', async () => {
    const host = new MockHost();
    await run('on h\n  put "OK" into x\n  set the visible of button x to false\nend h', 'h', host);
    expect(host.properties.get('visible')).toBe('false');
    expect(host.refCalls).toEqual([{ method: 'setProperty', ref: { type: 'button', name: 'OK' } }]);
  });
});

describe('regression — me resolution', () => {
  const ME = { type: 'button' as const, name: 'Flip' };

  it('show/hide/set/the-of receive the resolved me', async () => {
    const host = new MockHost();
    await run(`on h
  show me
  hide me
  set the label of me to "x"
  get the label of me
end h`, 'h', host, { me: ME });
    expect(host.refCalls).toEqual([
      { method: 'show', ref: ME },
      { method: 'hide', ref: ME },
      { method: 'setProperty', ref: ME },
      { method: 'getProperty', ref: ME },
    ]);
  });

  it('a directly called handler keeps the same me', async () => {
    const host = new MockHost();
    await run('on h\n  helper\nend h\non helper\n  show me\nend helper', 'h', host, { me: ME });
    expect(host.refCalls).toEqual([{ method: 'show', ref: ME }]);
  });

  it('using me with no owner object is a NecroTalkError', async () => {
    await expect(run('on h\n  show me\nend h')).rejects.toThrow('Line 2: "me" is not available here.');
  });
});

describe('regression — built-in function arity', () => {
  it('random with no arguments', async () => {
    await expect(run('on h\n  put random() into it\nend h')).rejects.toThrow('Line 2: random expects 1 argument.');
  });

  it('random with two arguments', async () => {
    await expect(run('on h\n  put random(1, 2) into it\nend h')).rejects.toThrow('Line 2: random expects 1 argument.');
  });

  it('length with no arguments', async () => {
    await expect(run('on h\n  put length() into it\nend h')).rejects.toThrow('Line 2: length expects 1 argument.');
  });

  it('length with one argument still works', async () => {
    const { host } = await run('on h\n  put length("boo") into field "Out"\nend h');
    expect(host.fields.get('Out')).toBe('3');
  });
});

describe('regression — fourth reviewer pass', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    it(`${name}(1) is an Unknown function, not a prototype lookup`, async () => {
      await expect(run(`on h\n  put ${name}(1) into it\nend h`))
        .rejects.toThrow(`Line 2: Unknown function "${name.toLowerCase()}".`);
    });
  }

  it('a non-number with newlines produces a single-line error', async () => {
    const host = new MockHost();
    host.fields.set('Notes', 'line one\nline two');
    try {
      await run('on h\n  put field "Notes" + 1 into it\nend h', 'h', host);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NecroTalkError);
      expect((e as NecroTalkError).message).toBe('Line 2: Expected a number but got "line one line two".');
    }
  });

  it('a long non-number is truncated in the error', async () => {
    await expect(run(`on h\n  put "${'x'.repeat(60)}" + 1 into it\nend h`))
      .rejects.toThrow(`Line 2: Expected a number but got "${'x'.repeat(40)}…".`);
  });
});

describe('regression — fifth reviewer pass: globals and put targets', () => {
  it('an undeclared name does not see the stack-wide global', async () => {
    const host = new MockHost();
    const globals = new Map([['score', '10']]);
    await evaluate(parse('on h\n  put score into field "Out"\nend h'), 'h', [], host, globals);
    expect(host.fields.get('Out')).toBe('score'); // unset local evaluates to its own name
    expect(globals.get('score')).toBe('10');
  });

  it('an undeclared put does not touch the stack-wide global', async () => {
    const globals = new Map([['score', '10']]);
    await evaluate(parse('on h\n  put 99 into score\nend h'), 'h', [], new MockHost(), globals);
    expect(globals.get('score')).toBe('10');
  });

  it('declaring global after a same-named local does not overwrite the global', async () => {
    const host = new MockHost();
    const globals = new Map([['score', '10']]);
    await evaluate(parse('on h\n  put 5 into score\n  global score\n  put score into field "Out"\nend h'),
      'h', [], host, globals);
    expect(globals.get('score')).toBe('10');
    expect(host.fields.get('Out')).toBe('10');
  });

  it('put after an unset variable starts from empty', async () => {
    const { host } = await run('on h\n  repeat 3 times\n    put "*" after stars\n  end repeat\n  put stars into field "Out"\nend h');
    expect(host.fields.get('Out')).toBe('***');
  });

  it('put before an unset declared global starts from empty', async () => {
    const globals = new Map<string, string>();
    await evaluate(parse('on h\n  global tag\n  put "x" before tag\nend h'), 'h', [], new MockHost(), globals);
    expect(globals.get('tag')).toBe('x');
  });
});
