// Sharing end to end (sharing REQ-6.2): autosave survives a reload; a share URL opens the same stack in a second
// page and leaves a prior autosave intact; Export's download is the stack; Import loads a file.
import { collectErrors, expect, test, type Page } from './apiMock.js';
import type { Stack } from '../../src/model/types.js';

/** Node's Buffer, reached without @types/node (the repo has none; see edit.spec.ts). */
const NodeBuffer = (globalThis as unknown as { Buffer: { from(s: string, e: string): Uint8Array } }).Buffer;

// Inlined to avoid importing the share modules (they transitively import stack.schema.json, which
// Playwright's loader will not take without a JSON import attribute). Must match src/share/autosave.ts.
const AUTOSAVE_KEY = 'necrocard.autosave';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });
const mode = (page: Page, name: 'Browse' | 'Edit') => page.getByRole('radio', { name, exact: true });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const sharePanel = (page: Page) => page.getByRole('dialog', { name: 'Share this stack' });

async function openQuiz(page: Page): Promise<void> {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
}

test('autosave: an edit survives a reload with no query or fragment', async ({ page }) => {
  const errors = collectErrors(page);
  await openQuiz(page);

  await mode(page, 'Edit').click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'edit');
  await page.getByRole('button', { name: 'Add button', exact: true }).click();
  // Give the new button a distinctive label so it is findable on the card after a reload
  // (a button's accessible name on the card is its label, not its object name).
  await inspector(page).getByLabel('Label', { exact: true }).fill('Lantern');
  await inspector(page).getByLabel('Label', { exact: true }).blur();
  // Wait past the 500 ms autosave debounce.
  await page.waitForTimeout(700);

  // Reload with a bare URL (no ?stack=, no #): the autosave must be what loads.
  await page.goto('/');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await mode(page, 'Edit').click();
  await expect(surface(page).getByRole('button', { name: 'Lantern', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('share: the URL opens the same stack in a second page, and a prior autosave is kept', async ({ page, context }) => {
  const errors = collectErrors(page);
  await openQuiz(page);

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(sharePanel(page)).toBeVisible();
  const url = await sharePanel(page).getByLabel('Share link').inputValue();
  expect(url).toContain('#s=');
  expect(url).not.toContain('?');
  expect(url.split('#s=')[1].length).toBeGreaterThan(0);

  // A second page already has its own autosave. Opening the link must not overwrite it.
  const page2 = await context.newPage();
  const errors2 = collectErrors(page2);
  await page2.goto('/');
  await expect(surface(page2)).toHaveAttribute('data-busy', 'false');
  // Seed a distinct autosave, then wait for any in-flight load to settle before navigating again.
  await page2.evaluate(key => {
    const raw = localStorage.getItem(key);
    const stack = JSON.parse(raw ?? '{}');
    stack.name = 'My Own Stack';
    localStorage.setItem(key, JSON.stringify(stack));
  }, AUTOSAVE_KEY);

  // Open the link as a fresh document (about:blank first), so it is a full load like opening a link
  // in a new tab — not a same-document fragment change on the already-open page.
  await page2.goto('about:blank');
  await page2.goto(url);
  await expect(surface(page2)).toHaveAttribute('data-busy', 'false');
  await expect(surface(page2)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page2)).toContainText('The Haunted Quiz');
  // openShared clears the fragment with replaceState once the stack has loaded.
  await page2.waitForFunction(() => location.hash === '');
  expect(page2.url()).not.toContain('?');

  // Reload with a bare URL: the visitor's own autosave is restored, not the shared stack.
  await page2.goto('/');
  await expect(surface(page2)).toHaveAttribute('data-busy', 'false');
  const savedName = await page2.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').name, AUTOSAVE_KEY);
  expect(savedName).toBe('My Own Stack');
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

test('export: the download decodes to the open stack; import loads a file', async ({ page }) => {
  const errors = collectErrors(page);
  await openQuiz(page);

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(sharePanel(page)).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await sharePanel(page).getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('The Haunted Quiz.necrocard.json');

  const path = await download.path();
  const fs = (await import(/* @vite-ignore */ ['node', 'fs/promises'].join(':'))) as {
    readFile(p: string, e: 'utf8'): Promise<string>;
  };
  const exported = JSON.parse(await fs.readFile(path, 'utf8')) as Stack;
  expect(exported.name).toBe('The Haunted Quiz');
  expect(exported.cards.length).toBeGreaterThan(1);

  // Import the same content through the hidden file input the dialog opens.
  const fileChooserPromise = page.waitForEvent('filechooser');
  await sharePanel(page).getByRole('button', { name: 'Import', exact: true }).click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles({
    name: 'imported.necrocard.json',
    mimeType: 'application/json',
    buffer: NodeBuffer.from(JSON.stringify(exported), 'utf8'),
  });

  await expect(sharePanel(page)).toHaveCount(0);
  await expect(surface(page)).toHaveAttribute('data-mode', 'edit');
  await expect(page.locator('#stack-picker option:checked')).toHaveText('The Haunted Quiz');
  expect(errors).toEqual([]);
});
