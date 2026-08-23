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


  test('the AI tab is sectioned, and each section is its own address', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW AiSections ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/workspace/aibehavior');
    //? Six stacked panels became four sections, the same shape the Repository tab uses. Clicking one
    //? must change the URL — a rail that only swaps the body leaves the section unlinkable, which is
    //? the defect ADR 0312 removed everywhere else.
    //? role="tab": the section rail is a real tablist (ADR 0312's accessibility pass), the same as
    //? the Repository tab's sections.
    await page.getByRole('tab', { name: 'Backends', exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces\/workspace\/aibehavior\/backends$/);
    await expect(page.getByRole('heading', { name: 'Connected AIs' })).toBeVisible();

    await page.getByRole('tab', { name: 'Custom tasks', exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces\/workspace\/aibehavior\/tasks$/);

    //? …and a typed address lands on that section directly, not on the first one.
    await page.goto('/workspaces/workspace/aibehavior/skills');
    await expect(page).toHaveURL(/\/aibehavior\/skills$/);
    await expect(page.getByRole('heading', { name: 'Connected AIs' })).toHaveCount(0);
  });

  test('the pipeline AI tip links to the real Carry-over tab rather than dropping it', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW TipTab ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    //? The regression lived in the link's navigate call: it computed "carryover" and then threw it
    //? away, landing on the stage's GENERAL tab while the button said Carry-over. It used to be
    //? exercised from the workspace AI page, but that page now shows the one-shot prompt model (no
    //? stage layers, ADR 0323), so the only place this link exists is a stage's own tip.
    await page.goto('/workspaces/develop/pipeline');
    await expect(page.getByText('AI persona (system prompt)', { exact: true })).toBeVisible();
    const personaRow = page.getByText('AI persona (system prompt)', { exact: true }).locator('xpath=..');
    await personaRow.getByRole('button', { name: /More information/ }).first().hover();
    const tip = page.getByRole('dialog', { name: 'More information' });

    await tip.getByRole('button', { name: /Edit on the Carry-over tab/ }).click();
    await expect(page).toHaveURL(/\/workspaces\/develop\/pipeline\/[^/]+\/carryover$/);
  });
});
