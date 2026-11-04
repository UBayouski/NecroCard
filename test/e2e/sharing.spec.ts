// Sharing end to end (sharing REQ-6.2): autosave survives a reload; a share URL opens the same stack in a second
// page and leaves a prior autosave intact; Export's download is the stack; Import loads a file.
import { collectErrors, expect, mockUnconfiguredServer, test, type Page } from './apiMock.js';
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

// A person presses F5, which reloads the URL the app itself wrote (?stack=quiz). ?stack= outranks the autosave, so
// the app must drop it once a person edits; otherwise every reload silently reset the sample and threw the work away.
for (const start of ['/', '/?stack=quiz']) {
  test(`autosave: a real reload (F5) after an edit keeps the edit, starting from ${start}`, async ({ page }) => {
    await page.goto(start);
    await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
    await expect(surface(page)).toHaveAttribute('data-busy', 'false');
    await mode(page, 'Edit').click();
    await page.getByRole('button', { name: 'Add button', exact: true }).click();
    await inspector(page).getByLabel('Label', { exact: true }).fill('Lantern');
    await inspector(page).getByLabel('Label', { exact: true }).blur();
    await page.waitForTimeout(700);
    expect(new URL(page.url()).searchParams.has('stack')).toBe(false); // the sample link is gone once it is theirs

    await page.reload();
    await expect(surface(page)).toHaveAttribute('data-busy', 'false');
    await expect(surface(page).getByRole('button', { name: 'Lantern', exact: true })).toHaveCount(1);
    // The reloaded stack is still named "The Haunted Quiz"; the picker must not show it twice under
    // the bundled sample's own title, so the restored autosave is marked as the person's copy.
    await expect(page.locator('#stack-picker option:checked')).toHaveText('The Haunted Quiz (your copy)');
  });
}

test('autosave: playing the sample without editing keeps the link, so a reload starts it fresh', async ({ page }) => {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await surface(page).getByRole('button', { name: 'Enter if you dare...', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Q1');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  expect(new URL(page.url()).searchParams.get('stack')).toBe('quiz');

  await page.reload();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title'); // a fresh quiz, not mid-play
});

test('autosave: typing into an unlocked field in Browse is saved (and a reload keeps it)', async ({ page }) => {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  // Make an unlocked field: add one in Edit mode, untick "Lock text", then type into it in Browse.
  await mode(page, 'Edit').click();
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await inspector(page).getByLabel('Lock text', { exact: true }).uncheck();
  await mode(page, 'Browse').click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'browse');
  await page.waitForTimeout(700); // let the edit-mode autosave settle so the typing below is what we test
  const field = surface(page).locator('.field textarea.field-text');
  await field.fill('written in browse mode');
  await page.waitForTimeout(700);

  await page.reload();
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(surface(page).locator('.field textarea.field-text')).toHaveValue('written in browse mode');
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
  await mockUnconfiguredServer(page2); // the auto fixture only covers the test's own page
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
  await expect(page.locator('#stack-picker option:checked')).toHaveText('The Haunted Quiz (your copy)');
  expect(errors).toEqual([]);
});
