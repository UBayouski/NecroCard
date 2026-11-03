import { expect, test, type Page } from '@playwright/test';
import { encodeBitsPngBytes } from '../../src/ui/edit/png.js';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });
const mode = (page: Page, name: 'Browse' | 'Edit') => page.getByRole('radio', { name, exact: true });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

/** Node's Buffer, reached without @types/node (the repo has none; see playwright.config.ts). */
const NodeBuffer = (globalThis as unknown as { Buffer: { from(data: Uint8Array): Uint8Array } }).Buffer;

/** A valid 40 × 20 checkerboard PNG, made with the project's own encoder (no fixture file). */
const CHECKER_PNG = NodeBuffer.from(encodeBitsPngBytes(
  Uint8Array.from({ length: 40 * 20 }, (_, i) => ((i % 40) + Math.floor(i / 40)) & 1), 40, 20,
));

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

/** Switch to Edit, add a button, and give it a script through the inspector. */
async function addButtonWithScript(page: Page, script: string) {
  await mode(page, 'Edit').click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'edit');
  await page.getByRole('button', { name: 'Add button', exact: true }).click();
  await expect(inspector(page).getByRole('heading', { level: 2 })).toHaveText('Button "Button 1"');
  await expect(surface(page)).toHaveAttribute('data-selected-id', /.+/);
  await inspector(page).getByLabel('Script', { exact: true }).fill(script);
}

test('quiz: add a button that goes next, switch to Browse, click it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');

  await addButtonWithScript(page, 'on mouseUp\n  go next\nend mouseUp');

  await mode(page, 'Browse').click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'browse');
  await expect(inspector(page)).toHaveCount(0);

  await surface(page).getByRole('button', { name: 'Button 1', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Q1');
  expect(errors).toEqual([]);
});

test('image import: local file becomes a 1-bit PNG data URL, no network requests', async ({ page, baseURL }) => {
  const errors = collectErrors(page);
  const foreign: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', req => {
    const url = req.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await mode(page, 'Edit').click();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add image', exact: true }).click();
  await (await chooser).setFiles({ name: 'checker.png', mimeType: 'image/png', buffer: CHECKER_PNG });

  await expect(inspector(page).getByRole('heading', { level: 2 })).toHaveText('Image "Image 1"');
  await expect(inspector(page).getByLabel('W', { exact: true })).toHaveValue('40');
  await expect(inspector(page).getByLabel('H', { exact: true })).toHaveValue('20');
  const img = surface(page).locator('img.image');
  await expect(img).toHaveCount(1);
  const src = await img.getAttribute('src');
  expect(src).toMatch(/^data:image\/png;base64,/);
  // The decoded result is our own 1-bit PNG: IHDR bit depth 1, colour type 0.
  const bytes = Uint8Array.from(atob(src!.split(',')[1]), c => c.charCodeAt(0));
  expect([bytes[24], bytes[25]]).toEqual([1, 0]);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test('New Stack: add a button that renames itself, click it in Browse', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');

  await page.getByRole('button', { name: 'New Stack', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Stack', exact: true })).toHaveValue('untitled');
  await expect(page.getByRole('combobox', { name: 'Stack', exact: true }).locator('option:checked')).toHaveText('Untitled');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Card 1');
  await expect(page).not.toHaveURL(/stack=/);

  await addButtonWithScript(page, 'on mouseUp\n  set the label of me to "Clicked"\nend mouseUp');
  await mode(page, 'Browse').click();
  await surface(page).getByRole('button', { name: 'Button 1', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(surface(page).getByRole('button', { name: 'Clicked', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('');
  expect(errors).toEqual([]);
});
