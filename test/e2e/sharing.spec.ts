// Sharing end to end: a share URL opens the same stack in a second page (fragment cleared), and Export's download
// is the stack / Import loads a file. The autosave cases moved to the stack library (see stack-library.spec.ts),
// which supersedes sharing REQ-2.
import { collectErrors, expect, mockUnconfiguredServer, test, type Page } from './apiMock.js';
import type { Stack } from '../../src/model/types.js';

/** Node's Buffer, reached without @types/node (the repo has none; see edit.spec.ts). */
const NodeBuffer = (globalThis as unknown as { Buffer: { from(s: string, e: string): Uint8Array } }).Buffer;

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });
const sharePanel = (page: Page) => page.getByRole('dialog', { name: 'Share this stack' });

async function openQuiz(page: Page): Promise<void> {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
}

test('share: the URL opens the same stack in a second page, with the fragment cleared', async ({ page, context }) => {
  const errors = collectErrors(page);
  await openQuiz(page);

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(sharePanel(page)).toBeVisible();
  const url = await sharePanel(page).getByLabel('Share link').inputValue();
  expect(url).toContain('#s=');
  expect(url).not.toContain('?');
  expect(url.split('#s=')[1].length).toBeGreaterThan(0);

  const page2 = await context.newPage();
  await mockUnconfiguredServer(page2); // the auto fixture only covers the test's own page
  const errors2 = collectErrors(page2);

  // Open the link as a fresh document (about:blank first), like opening a link in a new tab.
  await page2.goto('about:blank');
  await page2.goto(url);
  await expect(surface(page2)).toHaveAttribute('data-busy', 'false');
  await expect(surface(page2)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page2)).toContainText('The Haunted Quiz');
  // openShared clears the fragment with replaceState once the stack has loaded.
  await page2.waitForFunction(() => location.hash === '');
  expect(page2.url()).not.toContain('?');
  // A shared link says so in the status line, and the entry cannot repeat the bundled sample's name.
  await expect(page2.locator('.status-line')).toHaveText('Opened from a shared link');
  // A neutral notice: the info style in the chrome text colour, not the error red.
  await expect(page2.locator('.status-line')).toHaveClass(/status-line--info/);
  await expect(page2.locator('.status-line')).toHaveCSS('color', 'rgb(26, 26, 26)');
  await expect(page2.locator('#stack-picker option:checked')).toHaveText('The Haunted Quiz (shared)');
  // The next action clears it like any other status message.
  await page2.getByRole('button', { name: 'Enter if you dare...' }).click();
  await expect(surface(page2)).toHaveAttribute('data-card-name', 'Q1');
  await expect(page2.locator('.status-line')).toHaveText('');
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
  // Imported stacks become a library entry named after the stack; the name matches the bundled sample's, so it
  // gets the " (shared)" suffix and the picker never shows two identical labels.
  await expect(page.locator('#stack-picker option:checked')).toHaveText('The Haunted Quiz (shared)');
  await expect(page.locator('#stack-picker option', { hasText: /^The Haunted Quiz$/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});
