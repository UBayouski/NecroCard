// `play` end to end (necrotalk-play REQ-8.1). A stubbed AudioContext (installed before load via addInitScript)
// records created oscillators and their frequencies; clicking a quiz answer fires the gesture that unblocks audio
// and runs the answer's `play` fanfare. We assert a melody was scheduled and that no script error was reported.
import { expect, test, type Page } from './apiMock.js';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });

/** Install a fake AudioContext that records oscillator frequencies into window.__osc. */
async function stubAudio(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __osc: number[] }).__osc = [];
    class FakeParam {
      value = 0;
      setValueAtTime() { return this; }
      linearRampToValueAtTime() { return this; }
      cancelScheduledValues() { return this; }
    }
    class FakeNode { connect(n: unknown) { return n; } disconnect() {} }
    class FakeGain extends FakeNode { gain = new FakeParam(); }
    class FakeOsc extends FakeNode {
      type = 'sine';
      frequency = { value: 0 };
      onended: (() => void) | null = null;
      start() {}
      stop() { (window as unknown as { __osc: number[] }).__osc.push(this.frequency.value); }
    }
    class FakeAudioContext {
      currentTime = 0;
      destination = new FakeNode();
      createOscillator() { return new FakeOsc(); }
      createGain() { return new FakeGain(); }
      resume() { return Promise.resolve(); }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  });
}

test('clicking a quiz answer schedules a melody and logs no script error', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(e.message));

  await stubAudio(page);
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');

  // Enter the quiz (first gesture; unblocks audio), then answer Q1.
  await surface(page).getByRole('button', { name: 'Enter if you dare...', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Q1');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await surface(page).getByRole('button', { name: 'A) A zombie', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Q2');

  // The answer's `play` scheduled a melody: one or more oscillators, each a positive frequency.
  const freqs = await page.evaluate(() => (window as unknown as { __osc: number[] }).__osc);
  expect(freqs.length).toBeGreaterThanOrEqual(1);
  expect(freqs.every(f => typeof f === 'number' && f > 0)).toBe(true);

  // No script error surfaced.
  await expect(page.getByRole('alert')).toHaveText('');
  const scriptErrors = consoleErrors.filter(e => !e.includes('/api/health') && !e.includes('favicon'));
  expect(scriptErrors).toEqual([]);
});
