//? Every setup-checklist row, clicked, asserted on where it lands.
//?
//? The owner: "de onboarding op de /board page is tot nu toe voor iedere stap die ik getest heb niet
//? functioneel". Two rows were already found to be hardcoded `done: false`; that was a display bug.
//? This covers the other half — whether the ACTION each row offers actually works — because nothing
//? did. Every earlier check on this feature verified copy and readiness booleans, never a click.
import { test, expect } from './fixtures';
import { createWorkspace } from './fixtures';

//? Scoped: the checklist's own buttons share names with controls elsewhere on the board.
const checklist = (page: import('@playwright/test').Page) => page.getByTestId('ws-setup-checklist');

//? Rows are addressed by id (`ws-setup-step-<id>`), not by label: the action button carries the same
//? generic name on every row, and the label text alone matches nested divs that hold no button.
async function clickFix(page: import('@playwright/test').Page, stepId: string): Promise<void> {
  await page.getByTestId(`ws-setup-step-${stepId}`).getByRole('button').last().click();
}

/** Rows already satisfied on a fresh workspace carry no action — say so rather than timing out. */
async function isOutstanding(page: import('@playwright/test').Page, stepId: string): Promise<boolean> {
  const row = page.getByTestId(`ws-setup-step-${stepId}`);
  if (await row.count() === 0) return false;
  return await row.getByRole('button').count() > 0;
}

test.describe('setup checklist actions', () => {
  test('every row lands on the page that actually fixes it', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Steps ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });
    await expect(checklist(page)).toBeVisible();

    const cases: { id: string; url: RegExp }[] = [
      { id: 'aiKey', url: /\/workspaces\/content\/settings\/admin$/ },
      { id: 'repo', url: /\/workspaces\/workspace\/repository/ },
      { id: 'context', url: /\/workspaces\/sources$/ },
      { id: 'media', url: /\/workspaces\/content\/settings\/admin$/ },
      { id: 'channel', url: /\/workspaces\/content\/settings\/channels$/ },
      { id: 'push', url: /\/workspaces\/settings\/account$/ },
    ];

    let checked = 0;
    for (const c of cases) {
      await page.goto('/workspaces/develop/board');
      await expect(checklist(page)).toBeVisible();
      //? A fresh workspace satisfies several rows already; only the outstanding ones have an action.
      if (!(await isOutstanding(page, c.id))) continue;
      await clickFix(page, c.id);
      await expect(page, `step "${c.id}" must land somewhere that fixes it`).toHaveURL(c.url);
      checked += 1;
    }
    //? Guard the guard: a locator that silently matched nothing would pass this test with zero checks.
    expect(checked, 'at least one outstanding step was actually exercised').toBeGreaterThan(0);
  });

  test('the two action rows do their action instead of navigating', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW StepActions ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    //? The Agency pack seeds welcome tickets, so this row is usually already satisfied — asserting the
    //? click unconditionally would be asserting a state the fixture never reaches.
    if (await isOutstanding(page, 'firstTicket')) {
      await clickFix(page, 'firstTicket');
      await expect(page.getByText('My first task')).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.getByTestId('ws-setup-step-firstTicket').getByRole('button')).toHaveCount(0);
    }

    // "Ask the Workspace-AI something" opens the assistant panel.
    await page.goto('/workspaces/develop/board');
    await clickFix(page, 'askAi');
    await expect(page.getByRole('button', { name: 'Chat' })).toBeVisible();
  });
});
