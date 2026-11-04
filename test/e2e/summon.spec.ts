// Summon end to end with mocked /api routes (summon REQ-9.3). No real network: page.route answers both paths,
// overriding the unconfigured-server mock from apiMock.ts.
import { collectErrors, expect, test, type Page } from './apiMock.js';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });
const mode = (page: Page, name: 'Browse' | 'Edit') => page.getByRole('radio', { name, exact: true });
const summonPanel = (page: Page) => page.getByRole('dialog', { name: 'Summon a stack' });

const NEXT_SCRIPT = 'on mouseUp\n  put "Correct!" into field "Feedback"\n  go next\nend mouseUp';
const BROKEN_SCRIPT = 'on mouseUp\n  put "Correct!" into field "Feedback"\n  sort lines of x\n  go next\nend mouseUp';
const BROKEN_LINE = 3;

/** A valid two-card quiz in the stack schema. */
function twoCardQuiz(answerScript = NEXT_SCRIPT) {
  const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  return {
    id: 'stkGhost01',
    name: 'Ghost Quiz',
    backgrounds: [{ id: 'bgGhost01', name: 'Quiz', script: '', objects: [] }],
    cards: [
      {
        id: 'cdQuest01', name: 'Question', backgroundId: 'bgGhost01', script: '',
        objects: [
          {
            id: 'fdQuest01', name: 'Prompt', type: 'field', rect: rect(56, 40, 400, 60), visible: true, script: '',
            text: 'Which room is haunted?', lockText: true, style: 'transparent',
          },
          {
            id: 'fdFeedb01', name: 'Feedback', type: 'field', rect: rect(56, 200, 400, 30), visible: true, script: '',
            text: '', lockText: true, style: 'transparent',
          },
          {
            id: 'btAnswr01', name: 'Attic', type: 'button', rect: rect(206, 260, 100, 28), visible: true,
            script: answerScript, style: 'roundRect', label: 'The attic', autoHilite: true,
          },
        ],
      },
      {
        id: 'cdResul01', name: 'Results', backgroundId: 'bgGhost01', script: '',
        objects: [
          {
            id: 'fdResul01', name: 'Result', type: 'field', rect: rect(56, 120, 400, 60), visible: true, script: '',
            text: 'You found the ghost!', lockText: true, style: 'transparent',
          },
        ],
      },
    ],
    script: '',
    metadata: { created: '2026-11-03T14:00:00.000Z', modified: '2026-11-03T14:00:00.000Z', author: 'Summon' },
  };
}

interface Recorded { kind: string; payload: { prompt?: string; errors?: string[] } }

/** Answer /api/summon with the given model texts in order, recording each request body. */
async function mockSummon(page: Page, texts: string[]): Promise<Recorded[]> {
  const requests: Recorded[] = [];
  await page.route('**/api/health', route =>
    route.fulfill({ status: 200, json: { ok: true, model: 'gemini-3.5-flash-lite', remainingDay: 100 } }));
  await page.route('**/api/summon', route => {
    requests.push(route.request().postDataJSON() as Recorded);
    const left = 100 - requests.length;
    const text = texts[requests.length - 1] ?? '';
    return route.fulfill({
      status: 200,
      headers: { 'X-Summon-Remaining-Day': String(left), 'X-Summon-Remaining-Ip': String(10 - requests.length) },
      json: { ok: true, text },
    });
  });
  return requests;
}

async function summon(page: Page, prompt: string) {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await page.getByRole('button', { name: 'Summon', exact: true }).click();
  const panel = summonPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Using the NecroCard server');
  await panel.getByLabel('Describe your stack').fill(prompt);
  await panel.getByRole('button', { name: 'Summon', exact: true }).click();
}

/** The summoned stack is loaded in Edit mode, named in the picker, and has both cards. */
async function expectLoadedInEdit(page: Page) {
  await expect(summonPanel(page)).toHaveCount(0);
  await expect(surface(page)).toHaveAttribute('data-mode', 'edit');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Question');
  await expect(page.locator('#stack-picker option:checked')).toHaveText('Ghost Quiz');
  expect(new URL(page.url()).searchParams.get('stack')).toBeNull();

  await mode(page, 'Browse').click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'browse');
  await surface(page).getByRole('button', { name: 'The attic', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Results');
  await expect(surface(page)).toContainText('You found the ghost!');
}

test('summon "a two-card quiz": the stack loads in Edit mode with both cards', async ({ page }) => {
  const errors = collectErrors(page);
  const requests = await mockSummon(page, [JSON.stringify(twoCardQuiz())]);
  await summon(page, 'a two-card quiz');
  await expectLoadedInEdit(page);
  expect(requests).toEqual([{ kind: 'summon', payload: { prompt: 'a two-card quiz' } }]);
  expect(errors).toEqual([]);
});

test('one broken script is retried with its line number, and the corrected stack loads', async ({ page }) => {
  const errors = collectErrors(page);
  const broken = JSON.stringify(twoCardQuiz(BROKEN_SCRIPT));
  const requests = await mockSummon(page, [`Here is your stack:\n\`\`\`json\n${broken}\n\`\`\``, JSON.stringify(twoCardQuiz())]);
  await summon(page, 'a two-card quiz');
  await expectLoadedInEdit(page);

  expect(requests.map(r => r.kind)).toEqual(['summon', 'retry']);
  const retryErrors = requests[1].payload.errors ?? [];
  expect(retryErrors).toHaveLength(1);
  expect(retryErrors[0]).toMatch(
    new RegExp(`^Script of button "Attic" on card "Question": Line ${BROKEN_LINE}: `),
  );
  expect(errors).toEqual([]);
});
