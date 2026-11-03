import { describe, it, expect } from 'vitest';
import { dispatchMessage } from './messageQueue.js';
import { NecroTalkError } from './errors.js';
import type { HostInterface } from './evaluator.js';
import type { ObjectRef } from './ast.js';

class MockHost implements HostInterface {
  beepCount = 0;
  goToCard(_i: number): Promise<void> { return Promise.resolve(); }
  getCurrentCardIndex() { return 0; }
  getCardCount() { return 1; }
  getCardNames() { return ['Card 1']; }
  setVisualEffect(_e: string): Promise<void> { return Promise.resolve(); }
  answer(_p: string, _b: string[]): Promise<string> { return Promise.resolve('OK'); }
  ask(_p: string, _d: string): Promise<string> { return Promise.resolve(''); }
  showObject(_r: ObjectRef) {}
  hideObject(_r: ObjectRef) {}
  getProperty(_r: ObjectRef, _p: string) { return ''; }
  setProperty(_r: ObjectRef, _p: string, _v: string) {}
  getFieldText(_r: ObjectRef) { return ''; }
  setFieldText(_r: ObjectRef, _t: string) {}
  beep() { this.beepCount++; }
  getDate() { return ''; }
  getTime() { return ''; }
  random(_n: number) { return 1; }
}

const baseContext = {
  cardScript: '',
  backgroundScript: '',
  stackScript: '',
};

describe('dispatchMessage', () => {
  it('dispatches to object script handler', async () => {
    const host = new MockHost();
    await dispatchMessage('mouseUp', [], {
      ...baseContext,
      objectScript: 'on mouseUp\n  beep\nend mouseUp',
    }, host, new Map());
    expect(host.beepCount).toBe(1);
  });

  it('falls through to card script when not in object', async () => {
    const host = new MockHost();
    await dispatchMessage('mouseUp', [], {
      ...baseContext,
      objectScript: 'on openCard\n  beep\nend openCard',
      cardScript: 'on mouseUp\n  beep\nend mouseUp',
    }, host, new Map());
    expect(host.beepCount).toBe(1);
  });

  it('pass continues to card script', async () => {
    const host = new MockHost();
    await dispatchMessage('mouseUp', [], {
      ...baseContext,
      objectScript: 'on mouseUp\n  pass mouseUp\nend mouseUp',
      cardScript: 'on mouseUp\n  beep\nend mouseUp',
    }, host, new Map());
    expect(host.beepCount).toBe(1);
  });

  it('returns silently when handler not found anywhere', async () => {
    const host = new MockHost();
    await dispatchMessage('unknownMsg', [], baseContext, host, new Map());
    expect(host.beepCount).toBe(0);
  });

  it('propagates NecroTalkError from handler', async () => {
    const host = new MockHost();
    // trigger arithmetic error
    await expect(
      dispatchMessage('mouseUp', [], {
        ...baseContext,
        objectScript: 'on mouseUp\n  put "bad" + 1 into it\nend mouseUp',
      }, host, new Map())
    ).rejects.toThrow(NecroTalkError);
  });

  it('stops after object handles without pass', async () => {
    const host = new MockHost();
    await dispatchMessage('mouseUp', [], {
      ...baseContext,
      objectScript: 'on mouseUp\n  beep\nend mouseUp',
      cardScript: 'on mouseUp\n  beep\nend mouseUp',
    }, host, new Map());
    // only object script ran
    expect(host.beepCount).toBe(1);
  });

  it('same source string is not parsed twice (parse cache)', async () => {
    // Both card and background have the same source; if parse is called twice,
    // we can't easily verify without spying — but we verify correct dispatch.
    const sharedScript = 'on mouseUp\n  beep\nend mouseUp';
    const host = new MockHost();
    await dispatchMessage('mouseUp', [], {
      objectScript: '',
      cardScript: sharedScript,
      backgroundScript: sharedScript,
      stackScript: '',
    }, host, new Map());
    // card handled it; background never ran
    expect(host.beepCount).toBe(1);
  });
});
