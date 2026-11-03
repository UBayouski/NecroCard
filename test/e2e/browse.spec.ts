import { expect, test, type Page } from '@playwright/test';

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
