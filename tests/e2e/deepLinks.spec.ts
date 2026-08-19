//? Deep links and sub-navigation, CLICKED. Every defect asserted here was found by a behavioural audit
//? after months of checks that verified copy and types and never opened a menu — so each test below
//? exists because the thing it covers was silently wrong in production.
import { test, expect } from './fixtures';
import { createWorkspace } from './fixtures';

test.describe('deep links', () => {
  test('content settings tabs switch tab instead of leaving the page', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW ContentTabs ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/content/settings');
    //? The page's own tab bar used to navigate the user OFF to the Content overview: `setTrail` built
    //? its URL from the derived VIEW (`content`), whose path is not a trail root, so the trail was
    //? dropped. Deep links into the same tabs worked, which is exactly why nobody noticed.
    await page.getByRole('tab', { name: /Channels/ }).click();
    await expect(page).toHaveURL(/\/workspaces\/content\/settings\/channels$/);

    await page.getByRole('tab', { name: /Brand/ }).click();
    await expect(page).toHaveURL(/\/workspaces\/content\/settings\/brand$/);
  });


  test('the AI-key page is reachable on a workspace without the Content module', async ({ authedPage }) => {
    const page = authedPage;
    //? A Development-only workspace. `/workspaces/content/settings` derives the gateable view
    //? `content`, so the module guard bounced every visitor whose workspace lacks that section —
    //? including the setup checklist's FIRST row and five other "fix this" buttons, all of which point
    //? here. The page holds the workspace-wide AI and media provider keys; it is a settings page that
    //? happens to live under a content path.
    await createWorkspace(page, `E2E PW DevOnly ${String(Date.now())}`, ['development']);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    //? Guard the guard: if the module deselection silently failed, the workspace would still have
    //? Content and this test would pass while proving nothing.
    await expect(page.getByRole('button', { name: 'Content', exact: true })).toHaveCount(0);

    await page.goto('/workspaces/content/settings/admin');
    await expect(page).toHaveURL(/\/workspaces\/content\/settings\/admin$/);
  });

  test('adding a stage selects THAT stage, not the one that was already open', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW AddStage ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/develop/pipeline');
    await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();
    const before = await page.getByRole('button', { name: /^\d+\s/ }).count();

    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();

    // The strip grew...
    await expect(page.getByRole('button', { name: /^\d+\s/ })).toHaveCount(before + 1);
    //? ...and the URL points at the NEW stage. Two navigations used to race here and the second one,
    //? built from the previous render's selection, won — so everything typed next was saved onto the
    //? stage that happened to be open before.
    await expect(page).toHaveURL(/\/workspaces\/develop\/pipeline\/stage-\d+-\d+\/general$/);
  });

  test('the workspace AI tip links to a real stage tab rather than dropping it', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW TipTab ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/workspace/aibehavior');
    await page.getByRole('button', { name: /More information/ }).first().click();
    const tip = page.getByRole('dialog', { name: 'More information' });

    //? This page has no stage of its own, so the link used to compute "carryover" and then throw it
    //? away, landing on the first stage's GENERAL tab while the button said Carry-over.
    await tip.getByRole('button', { name: /Edit on the Carry-over tab/ }).click();
    await expect(page).toHaveURL(/\/workspaces\/develop\/pipeline\/[^/]+\/carryover$/);
  });
});
