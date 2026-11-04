import { expect, test, type Page } from './apiMock.js';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });

/** Click a card button by accessible name, then wait for the runtime to settle on `cardName`. */
async function clickThrough(page: Page, button: string, cardName: string) {
  await surface(page).getByRole('button', { name: button, exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(surface(page)).toHaveAttribute('data-card-name', cardName);
}

test('quiz: title → Q1 → Q2 → Q3 → Results', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(page.getByRole('combobox', { name: 'Stack', exact: true })).toHaveValue('quiz');

  await clickThrough(page, 'Enter if you dare...', 'Q1');
  await clickThrough(page, 'A) A zombie', 'Q2');
  await clickThrough(page, 'B) October', 'Q3');
  await clickThrough(page, 'B) A lit jack-o-lantern', 'Results');

  await expect(surface(page)).toHaveAttribute('data-card-index', '4');
  await expect(surface(page)).toContainText('You survived the Haunted Quiz!');
  await expect(page.getByRole('alert')).toHaveText('');
  expect(errors).toEqual([]);
});

test('favicon is served, so the browser logs no 404', async ({ page }) => {
  const res = await page.request.get('/favicon.ico');
  expect(res.status()).toBe(200);
  expect((await res.body()).length).toBe(198);
});

// Summoned stacks put Next and Prev on the BACKGROUND. The full-size card-objects layer sits above the background
// layer, so before pointer-events were passed through, a click on a background button landed on the empty card layer.
// The bundled fixtures have empty backgrounds, which is why nothing caught it.
test('a button on the background takes a real mouse click, with card objects elsewhere on the card', async ({ page }) => {
  const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const base = { visible: true, script: '' };
  const bgButton = {
    ...base, id: 'btNext0001', name: 'Next', type: 'button', rect: rect(206, 280, 100, 28),
    script: 'on mouseUp\n  go next\nend mouseUp', style: 'roundRect', label: 'Next', autoHilite: true,
  };
  // A card field on each card, away from the button, so the card-objects layer is not empty.
  const cardField = (id: string, text: string) => ({
    ...base, id, name: 'Word', type: 'field', rect: rect(56, 60, 400, 60), text, lockText: true, style: 'transparent',
  });
  const stack = {
    id: 'stkClick01', name: 'Background Click',
    backgrounds: [{ id: 'bgMain0001', name: 'Main', objects: [bgButton], script: '' }],
    cards: [
      { id: 'cdOne00001', name: 'One', backgroundId: 'bgMain0001', objects: [cardField('fdOne00001', 'first')], script: '' },
      { id: 'cdTwo00001', name: 'Two', backgroundId: 'bgMain0001', objects: [cardField('fdTwo00001', 'second')], script: '' },
    ],
    script: '',
    metadata: { created: '2026-11-03T14:00:00.000Z', modified: '2026-11-03T14:00:00.000Z', author: 'test' },
  };

  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  // Encode with the app's own codec, served by the Vite dev server (Playwright's loader cannot import src/share).
  await page.goto('/');
  const fragment = await page.evaluate(async (s) => {
    const url = '/src/share/codec.ts';
    const codec = (await import(/* @vite-ignore */ url)) as { encodeStack(stack: unknown): Promise<string> };
    return codec.encodeStack(s);
  }, stack);

  // A full load from about:blank, like opening a link in a new tab (not a same-document fragment change).
  await page.goto('about:blank');
  await page.goto(`/#s=${fragment}`);
  await expect(surface(page)).toHaveAttribute('data-card-name', 'One');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(surface(page)).toContainText('first');

  // A real mouse click: Playwright first checks that the button itself is the element at the click point.
  await surface(page).getByRole('button', { name: 'Next', exact: true }).click({ timeout: 5000 });
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Two');
  await expect(surface(page)).toContainText('second');
  expect(errors).toEqual([]);
});
