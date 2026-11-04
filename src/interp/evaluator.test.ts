import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { evaluate, ExitRepeatException, NextRepeatException, PassException } from './evaluator.js';
import type { HostInterface, ResolvedObjectRef, EvaluateOptions } from './evaluator.js';
import type { Note } from './notes.js';
import { parse } from './parser.js';
import { NecroTalkError } from './errors.js';
import { KEYWORDS } from './tokenizer.js';

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
  /** Recorded play(notes, tempo) calls (necrotalk-play). */
  playCalls: { notes: Note[]; tempo: number }[] = [];
  stopSoundCount = 0;
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
  play(notes: Note[], tempo: number) { this.playCalls.push({ notes, tempo }); }
  stopSound() { this.stopSoundCount++; }
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

  it('play "c e g" calls play once with three notes at tempo 120', async () => {
    const { host } = await run('on h\n  play "c e g"\nend h');
    expect(host.playCalls).toHaveLength(1);
    expect(host.playCalls[0].tempo).toBe(120);
    expect(host.playCalls[0].notes).toHaveLength(3);
    expect(host.playCalls[0].notes.every(n => n.frequency !== null)).toBe(true);
  });

  it('play tempo 160 "c" passes the resolved tempo', async () => {
    const { host } = await run('on h\n  play tempo 160 "c"\nend h');
    expect(host.playCalls[0].tempo).toBe(160);
  });

  it('a second play in the same handler calls play again (replace is the host\'s job)', async () => {
    const { host } = await run('on h\n  play "c"\n  play "e"\nend h');
    expect(host.playCalls).toHaveLength(2);
  });

  it('play from a variable resolves the notes string', async () => {
    const { host } = await run('on h\n  put "c e g" into t\n  play t\nend h');
    expect(host.playCalls[0].notes).toHaveLength(3);
  });

  it('play stop calls stopSound and schedules no notes', async () => {
    const { host } = await run('on h\n  play stop\nend h');
    expect(host.stopSoundCount).toBe(1);
    expect(host.playCalls).toHaveLength(0);
  });

  it('a bad note token is a runtime error at the play line, naming the token, and plays nothing', async () => {
    const host = new MockHost();
    await expect(run('on h\n  beep\n  play "c e h9"\nend h', 'h', host)).rejects.toThrow(NecroTalkError);
    const err = await run('on h\n  play "c e h9"\nend h').catch(e => e) as NecroTalkError;
    expect(err).toBeInstanceOf(NecroTalkError);
    expect(err.message).toBe('Line 2: "h9" is not a note.');
    expect(err.line).toBe(2);
    expect(host.playCalls).toHaveLength(0);
  });

  it('a non-positive tempo is a runtime error at the play line', async () => {
    const err = await run('on h\n  play tempo 0 "c"\nend h').catch(e => e) as NecroTalkError;
    expect(err).toBeInstanceOf(NecroTalkError);
    expect(err.line).toBe(2);
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
    // Simulate an AST node the evaluator does not support (a still-unimplemented Phase 2 node)
    (script.handlers[0].body as unknown[]).push({ kind: 'find', line: 3 });
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

// ---------------------------------------------------------------------------
// Host errors carry the statement's line
// ---------------------------------------------------------------------------

/** A host whose chosen methods throw plain Errors, like the browser DomHost does. */
class ThrowingHost extends MockHost {
  constructor(private readonly failing: Set<string>, private readonly message = 'No field named "Ghost"') {
    super();
  }
  private check(method: string) {
    if (this.failing.has(method)) throw new Error(this.message);
  }
  override getFieldText(ref: ResolvedObjectRef) { this.check('getFieldText'); return super.getFieldText(ref); }
  override setFieldText(ref: ResolvedObjectRef, t: string) { this.check('setFieldText'); super.setFieldText(ref, t); }
  override getProperty(ref: ResolvedObjectRef, p: string) { this.check('getProperty'); return super.getProperty(ref, p); }
  override setProperty(ref: ResolvedObjectRef, p: string, v: string) { this.check('setProperty'); super.setProperty(ref, p, v); }
  override showObject(ref: ResolvedObjectRef) { this.check('showObject'); super.showObject(ref); }
  override hideObject(ref: ResolvedObjectRef) { this.check('hideObject'); super.hideObject(ref); }
  override beep() { this.check('beep'); super.beep(); }
  override getDate() { this.check('getDate'); return super.getDate(); }
  override getTime() { this.check('getTime'); return super.getTime(); }
  override getCurrentCardIndex() { this.check('getCurrentCardIndex'); return super.getCurrentCardIndex(); }
  override getCardNames() { this.check('getCardNames'); return super.getCardNames(); }
  override random(n: number) { this.check('random'); return super.random(n); }
  override getCardCount() { this.check('getCardCount'); return super.getCardCount(); }
  override async goToCard(i: number) { this.check('goToCard'); return super.goToCard(i); }
  override async answer(p: string, b: string[]) { this.check('answer'); return super.answer(p, b); }
  override async ask(p: string, d: string) { this.check('ask'); return super.ask(p, d); }
  override async setVisualEffect(e: string) { this.check('setVisualEffect'); return super.setVisualEffect(e); }
}

async function hostError(method: string, statement: string, message?: string): Promise<NecroTalkError> {
  const src = `on h\n  beep\n  ${statement}\nend h`;
  const host = new ThrowingHost(new Set([method]), message);
  const err = await evaluate(parse(src), 'h', [], host, new Map()).then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(NecroTalkError);
  return err as NecroTalkError;
}

describe('host errors become NecroTalkErrors at the statement line', () => {
  it.each([
    ['getFieldText', 'put field "Ghost" into x'],
    ['setFieldText', 'put "boo" into field "Ghost"'],
    ['getFieldText', 'put "boo" after field "Ghost"'],
    ['getProperty', 'put the label of button "Ghost" into x'],
    ['setProperty', 'set the label of button "Ghost" to "x"'],
    ['showObject', 'show field "Ghost"'],
    ['hideObject', 'hide field "Ghost"'],
    ['getDate', 'put the date into x'],
    ['getTime', 'put the time into x'],
    ['random', 'put random(6) into x'],
    ['getCardCount', 'put the number of cards into x'],
    ['getCardCount', 'go next'],
    ['getCurrentCardIndex', 'go next'],
    ['getCardNames', 'go to card "Beta"'],
    ['goToCard', 'go next'],
    ['answer', 'answer "boo"'],
    ['ask', 'ask "boo"'],
    ['setVisualEffect', 'visual effect dissolve'],
  ])('%s: %s', async (method, statement) => {
    const err = await hostError(method, statement);
    expect(err.message).toBe('Line 3: No field named "Ghost".');
    expect(err.line).toBe(3);
    expect(err.column).toBe(1);
  });

  it('reports the line of the statement inside nested blocks', async () => {
    const src = 'on h\n  repeat 2 times\n    if true then\n      show field "Ghost"\n    end if\n  end repeat\nend h';
    const err = await evaluate(parse(src), 'h', [], new ThrowingHost(new Set(['showObject'])), new Map())
      .catch((e: unknown) => e);
    expect((err as NecroTalkError).message).toBe('Line 4: No field named "Ghost".');
  });

  it('beep failing on line 2 is reported on line 2', async () => {
    const err = await hostError('beep', 'put 1 into x');
    expect(err.message).toBe('Line 2: No field named "Ghost".');
  });

  it('does not double the period and keeps the message on one line', async () => {
    expect((await hostError('showObject', 'show field "x"', 'Cannot hide a card.')).message)
      .toBe('Line 3: Cannot hide a card.');
    expect((await hostError('showObject', 'show field "x"', 'two\nlines')).message)
      .toBe('Line 3: two lines.');
    expect((await hostError('showObject', 'show field "x"', '')).message)
      .toBe('Line 3: The host reported an error.');
    expect((await hostError('showObject', 'show field "x"', '...')).message)
      .toBe('Line 3: The host reported an error.');
  });

  it('control-flow signals thrown through a host call are never converted', async () => {
    for (const signal of [new PassException('h'), new ExitRepeatException(), new NextRepeatException()]) {
      class SignalHost extends MockHost {
        override beep(): void { throw signal; }
      }
      const err = await evaluate(parse('on h\n  beep\nend h'), 'h', [], new SignalHost(), new Map())
        .catch((e: unknown) => e);
      expect(err).toBe(signal);
    }
  });

  it('non-Error throws are converted too', async () => {
    class StringHost extends MockHost {
      override beep(): void { throw 'speaker on fire'; }
    }
    const err = await evaluate(parse('on h\n  beep\nend h'), 'h', [], new StringHost(), new Map())
      .catch((e: unknown) => e);
    expect((err as NecroTalkError).message).toBe('Line 2: speaker on fire.');
  });

  it('a NecroTalkError from the host (e.g. a nested dispatch) passes through unchanged', async () => {
    const inner = new NecroTalkError('Line 7: Unknown command "boo".', 7, 3);
    class NestedHost extends MockHost {
      override goToCard(): Promise<void> { return Promise.reject(inner); }
    }
    const err = await evaluate(parse('on h\n  go next\nend h'), 'h', [], new NestedHost(), new Map())
      .catch((e: unknown) => e);
    expect(err).toBe(inner);
  });

  it('navigation errors keep their own message', async () => {
    const err = await evaluate(parse('on h\n  go to card "Nowhere"\nend h'), 'h', [], new MockHost(), new Map())
      .catch((e: unknown) => e);
    expect((err as NecroTalkError).message).toBe('Line 2: No card named "Nowhere".');
  });
});

// ---------------------------------------------------------------------------
// EvaluateOptions.implicitGlobals
// ---------------------------------------------------------------------------

describe('implicitGlobals', () => {
  const runImplicit = (src: string, globals: Map<string, string>, host = new MockHost(), args: string[] = []) =>
    evaluate(parse(src), 'h', args, host, globals, { implicitGlobals: true }).then(() => host);

  it('reads and writes the globals map without a global declaration', async () => {
    const globals = new Map([['score', '10']]);
    const host = await runImplicit('on h\n  put score + 1 into score\n  put score into field "Out"\nend h', globals);
    expect(globals.get('score')).toBe('11');
    expect(host.fields.get('Out')).toBe('11');
  });

  it('it lives in the globals map too', async () => {
    const globals = new Map<string, string>();
    await runImplicit('on h\n  get 5\n  put "!" after it\nend h', globals);
    expect(globals.get('it')).toBe('5!');
    const host = await runImplicit('on h\n  put it into field "Out"\nend h', globals);
    expect(host.fields.get('Out')).toBe('5!');
  });

  it('answer and ask results go to the global it', async () => {
    const globals = new Map<string, string>();
    const host = new MockHost();
    host.askResponse = 'Mina';
    await runImplicit('on h\n  ask "Name?"\nend h', globals, host);
    expect(globals.get('it')).toBe('Mina');
  });

  it('repeat with counters and parameters are global', async () => {
    const globals = new Map<string, string>();
    await runImplicit('on h who\n  repeat with i = 1 to 3\n  end repeat\nend h', globals, new MockHost(), ['Vlad']);
    expect(globals.get('i')).toBe('3');
    expect(globals.get('who')).toBe('Vlad');
  });

  it('unset variables still evaluate to their own name, and start empty as put targets', async () => {
    const globals = new Map<string, string>();
    const host = await runImplicit('on h\n  put ghost into field "A"\n  put "*" after stars\nend h', globals);
    expect(host.fields.get('A')).toBe('ghost');
    expect(globals.get('stars')).toBe('*');
    expect(globals.has('ghost')).toBe(false);
  });

  it('handlers called by name keep normal local scoping', async () => {
    const globals = new Map<string, string>();
    const src = 'on h\n  put 1 into x\n  helper\nend h\n\non helper\n  put 2 into x\n  put 3 into y\nend helper';
    await runImplicit(src, globals);
    expect(globals.get('x')).toBe('1');
    expect(globals.has('y')).toBe(false);
  });

  it('a called handler that declares the global sees what the implicit caller wrote, and can change it', async () => {
    const globals = new Map<string, string>();
    const src = 'on h\n  put "Boo" into ghost\n  helper\n  put ghost into field "Out"\nend h\n\n'
      + 'on helper\n  global ghost\n  put ghost into field "Seen"\n  put "Eek" into ghost\nend helper';
    const host = await runImplicit(src, globals);
    expect(host.fields.get('Seen')).toBe('Boo');
    expect(host.fields.get('Out')).toBe('Eek');
    expect(globals.get('ghost')).toBe('Eek');
  });

  it('a parameter with no argument sets that global to empty (parameters are variables)', async () => {
    const globals = new Map([['who', 'Vlad']]);
    await runImplicit('on h who\n  beep\nend h', globals);
    expect(globals.get('who')).toBe('');
  });

  it('defaults to off: without the option nothing leaks into globals', async () => {
    const globals = new Map<string, string>();
    await evaluate(parse('on h\n  put 1 into x\n  get 2\nend h'), 'h', [], new MockHost(), globals);
    expect(globals.size).toBe(0);
  });

  it('defaults to off: same-named globals are untouched by params, counters, put and it', async () => {
    const globals = new Map([['who', 'G1'], ['i', 'G2'], ['x', 'G3'], ['it', 'G4']]);
    const host = new MockHost();
    await evaluate(
      parse('on h who\n  repeat with i = 1 to 2\n  end repeat\n  put 9 into x\n  get 5\n  put who & i & x & it into field "Out"\nend h'),
      'h', ['arg'], host, globals,
    );
    expect(Object.fromEntries(globals)).toEqual({ who: 'G1', i: 'G2', x: 'G3', it: 'G4' });
    expect(host.fields.get('Out')).toBe('arg295');
  });

  it('PBT: put v into a variable with implicitGlobals stores v in globals under the lowercased name', async () => {
    const value = fc.string({ unit: 'grapheme' }).filter(s => !/["\r\n]/.test(s));
    const name = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,7}$/)
      .filter(n => !KEYWORDS.has(n.toLowerCase()));
    await fc.assert(
      fc.asyncProperty(name, value, async (n, v) => {
        const globals = new Map<string, string>();
        await runImplicit(`on h\n  put "${v}" into ${n}\nend h`, globals);
        expect(globals.get(n.toLowerCase())).toBe(v);
      }),
      { numRuns: 200 },
    );
  });
});
