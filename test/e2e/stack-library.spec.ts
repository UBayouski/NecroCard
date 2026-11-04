// Stack library end to end (stack-library REQ-8.2). The library keeps every non-sample stack in localStorage;
// switching is lossless, reloads reopen the last-open stack, Delete falls back to the quiz, editing a sample forks
// a copy, and a legacy autosave migrates. Supersedes the single-autosave cases of sharing.
import { expect, test, type Page } from './apiMock.js';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });
const mode = (page: Page, name: 'Browse' | 'Edit') => page.getByRole('radio', { name, exact: true });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const picker = (page: Page) => page.getByRole('combobox', { name: 'Stack', exact: true });
const checkedLabel = (page: Page) => picker(page).locator('option:checked');

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

async function addLabelledButton(page: Page, label: string) {
  await mode(page, 'Edit').click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'edit');
  await page.getByRole('button', { name: 'Add button', exact: true }).click();
  await inspector(page).getByLabel('Label', { exact: true }).fill(label);
  await inspector(page).getByLabel('Label', { exact: true }).blur();
  await page.waitForTimeout(700); // past the 500 ms save debounce
}

test('New Stack, edit, switch to a sample and back: the edit survives', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');

  await page.getByRole('button', { name: 'New Stack', exact: true }).click();
  await expect(checkedLabel(page)).toHaveText('Untitled');
  await addLabelledButton(page, 'Lantern');

  // Switch to a bundled sample.
  await picker(page).selectOption({ label: 'The Cursed Manor' });
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(checkedLabel(page)).toHaveText('The Cursed Manor');

  // Switch back to the Untitled entry.
  await picker(page).selectOption({ label: 'Untitled' });
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await mode(page, 'Edit').click();
  await expect(surface(page).getByRole('button', { name: 'Lantern', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('editing an entry and reloading reopens it with its edits', async ({ page }) => {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await page.getByRole('button', { name: 'New Stack', exact: true }).click();
  await addLabelledButton(page, 'Lantern');

  await page.reload();
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(checkedLabel(page)).toHaveText('Untitled');
  await mode(page, 'Edit').click();
  await expect(surface(page).getByRole('button', { name: 'Lantern', exact: true })).toHaveCount(1);
});

test('Delete removes the open entry and opens the quiz', async ({ page }) => {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await page.getByRole('button', { name: 'New Stack', exact: true }).click();
  await addLabelledButton(page, 'Lantern');
  await mode(page, 'Browse').click();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete stack' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Delete "Untitled"?'); // names the open entry (not an empty string)
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(checkedLabel(page)).toHaveText('The Haunted Quiz');
  // The entry is gone: the "My stacks" group has no "Untitled".
  await expect(picker(page).locator('option', { hasText: 'Untitled' })).toHaveCount(0);
});

test('editing a sample forks a (your copy) entry and leaves the sample pristine', async ({ page }) => {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');

  await addLabelledButton(page, 'Lantern'); // first authored edit of the sample
  await expect(checkedLabel(page)).toHaveText('The Haunted Quiz (your copy)');

  // Reopen the bundled sample: it is pristine (no Lantern button).
  await picker(page).selectOption({ label: 'The Haunted Quiz' });
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await mode(page, 'Edit').click();
  await expect(surface(page).getByRole('button', { name: 'Lantern', exact: true })).toHaveCount(0);

  // The forked copy still has it.
  await picker(page).selectOption({ label: 'The Haunted Quiz (your copy)' });
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await mode(page, 'Edit').click();
  await expect(surface(page).getByRole('button', { name: 'Lantern', exact: true })).toHaveCount(1);
});

test('a legacy necrocard.autosave value migrates into the library', async ({ page }) => {
  // Seed a legacy autosave, with an empty library, before the app boots.
  await page.addInitScript(() => {
    const quizName = 'The Haunted Quiz';
    const stack = {
      id: 'legacy0001', name: quizName, backgrounds: [{ id: 'bg00000001', name: 'B', objects: [], script: '' }],
      cards: [{ id: 'cd00000001', name: 'Only', backgroundId: 'bg00000001', objects: [], script: '' }],
      script: '', metadata: { created: '2026-11-04T00:00:00.000Z', modified: '2026-11-04T00:00:00.000Z', author: '' },
    };
    localStorage.setItem('necrocard.autosave', JSON.stringify(stack));
  });

  await page.goto('/');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  // It migrated as a (your copy) entry and is the open stack.
  await expect(checkedLabel(page)).toHaveText('The Haunted Quiz (your copy)');
  const legacy = await page.evaluate(() => localStorage.getItem('necrocard.autosave'));
  expect(legacy).toBeNull();
});

test('renaming a New Stack in the inspector updates the picker label and the window title', async ({ page }) => {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await page.getByRole('button', { name: 'New Stack', exact: true }).click();
  await mode(page, 'Edit').click();
  // The card inspector (no object selected) holds the Stack name field.
  await inspector(page).getByLabel('Stack name', { exact: true }).fill('Midnight Manor');
  await inspector(page).getByLabel('Stack name', { exact: true }).blur();
  await page.waitForTimeout(700);

  await expect(checkedLabel(page)).toHaveText('Midnight Manor');
  await expect(page.locator('.card-window-title-label')).toHaveText('Midnight Manor');
});

test('playing the quiz without an authored edit starts fresh on reload (no entry created)', async ({ page }) => {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await surface(page).getByRole('button', { name: 'Enter if you dare...', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Q1');

  await page.reload();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title'); // a fresh quiz, not mid-play
  // No library entry was created (the "My stacks" group is absent).
  await expect(picker(page).locator('optgroup[label="My stacks"]')).toHaveCount(0);
});
