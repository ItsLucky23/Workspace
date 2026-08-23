//? Workspaces — core-flow proof specs for the Develop group's "rest" pages: Pipeline (stage strip +
//? stage editor tabs + add-status), and the four teaching-empty-state pages (Terminals, Sources,
//? Scheduled, Answers) plus Code (read-only repo browser). Each spec gets its own throwaway
//? workspace via the shared fixture (see ./fixtures.ts for the auth + onboarding contract).
import { test, expect, createWorkspace } from './fixtures';

test.describe('pipeline', () => {
  test('stage strip renders, tabs switch cleanly, add-status expands', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Pipeline ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    await page.goto('/workspaces/develop/pipeline');
    await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();

    // Actual default: a fresh Agency workspace's project ships the 7-stage professional pipeline
    // (Unrefined → Refined → Plan → Implementation → Test → Review → Final). The strip's own
    // buttons carry a "<order> <name>" accessible name (e.g. "1 Unrefined") — distinct from the
    // stage-editor tab strip (General / Context / Model), which shares the same ws-no-scrollbar classes.
    const flowStrip = page.locator('div.flex.items-center.gap-1.overflow-x-auto.ws-no-scrollbar.pb-1.shrink-0');
    await expect(flowStrip).toBeVisible();
    const stageButtons = page.getByRole('button', { name: /^\d+\s/ });
    await expect(stageButtons).toHaveCount(7);

    // The strip itself must carry the no-visible-scrollbar utility class (a rendering-glitch guard).
    await expect(flowStrip).toHaveClass(/ws-no-scrollbar/);

    // Stage editor tabs: General / Context & Skills / Model & Effort — everyone-visible, always-on tabs.
    const generalTab = page.getByRole('tab', { name: 'General', exact: true });
    const contextTab = page.getByRole('tab', { name: 'Context & Skills', exact: true });
    const modelTab = page.getByRole('tab', { name: 'Model & Effort', exact: true });
    await expect(generalTab).toBeVisible();

    // The tab strip itself is the same ws-no-scrollbar-guarded row.
    const stageTabStrip = generalTab.locator('xpath=..');
    await expect(stageTabStrip).toHaveClass(/ws-no-scrollbar/);

    // General is active by default — its field (AI persona / system prompt) is present.
    await expect(page.getByText('AI persona (system prompt)', { exact: true })).toBeVisible();

    await contextTab.click();
    await expect(page.getByText('Context docs', { exact: true })).toBeVisible();
    await expect(page.getByText('AI persona (system prompt)', { exact: true })).toBeHidden();

    await modelTab.click();
    await expect(page.getByText('Let the agent pick the model', { exact: true })).toBeVisible();
    await expect(page.getByText('Context docs', { exact: true })).toBeHidden();

    await generalTab.click();
    await expect(page.getByText('AI persona (system prompt)', { exact: true })).toBeVisible();

    // ADR 0315 — the pipeline TIER is reachable after creation, and "Add stage" asks for the KIND
    // (the kind decides the blueprint the new stage arrives pre-filled with). Both are menus in the
    // header; opening the kind menu is asserted, choosing one is NOT — that would create a stage.
    await expect(page.getByRole('button', { name: 'Pipeline setup' })).toBeVisible();
    const addStage = page.getByRole('button', { name: 'Add stage' });
    await expect(addStage).toBeVisible();
    await addStage.click();
    await expect(page.getByRole('button', { name: 'Implementation', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
    //? Escape closes the menu (useClickAway) — leaves the pipeline exactly as it was found.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Implementation', exact: true })).toBeHidden();

    // The prompt-layer preview names five fields spread over two pages; each one that is edited
    // ELSEWHERE carries its own deep link. The carry-over template is the case that matters — it lives
    // behind the admin-only Advanced menu, which is exactly the tab nobody finds on their own.
    await page.getByRole('button', { name: /What the AI actually receives/ }).click();
    await expect(page.getByRole('button', { name: 'Edit on the Carry-over tab' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit in workspace AI settings' }).first()).toBeVisible();
    //? …and NOT for the two fields whose editors are on this very screen — a jump there would land the
    //? user where they already are, which is how an "edit" affordance loses its meaning.
    await expect(page.getByRole('button', { name: 'Edit on the General tab' })).toHaveCount(0);

    //? Fix-round: custom stage statuses were never read by tickets, so the editor no longer offers
    //? "Add status" — it shows the engine statuses and says so.
    await expect(page.getByText('Statuses', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add status' })).toHaveCount(0);
  });
});

test.describe('terminals / answers / sources / scheduled — teaching empty states', () => {
  test('terminals names the real repository prerequisite without an SSH gate', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Terminals ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    await page.goto('/workspaces/develop/terminals');
    await expect(page.getByRole('heading', { name: 'Terminals' })).toBeVisible();

    // ADR 0301: terminal access is session + workspace RBAC + exact container identity. A fresh
    // workspace has no repository/container yet, so teach that real prerequisite — never a fake SSH lock.
    await expect(page.getByText('No repository linked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link a repository' })).toBeVisible();
    await expect(page.getByText('Terminals locked')).toBeHidden();
  });

  test('answers renders its empty inbox teaching state', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Answers ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    await page.goto('/workspaces/develop/answers');
    await expect(page.getByRole('heading', { name: 'Answers' })).toBeVisible();
    await expect(page.getByText('Nothing is waiting on you')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View the board' })).toBeVisible();
  });

  test('sources renders (starter docs seeded, skills tab teaches its empty state)', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Sources ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    await page.goto('/workspaces/develop/sources');
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();

    // Actual default: a fresh Agency workspace ships with starter context docs (conventions +
    // design system), so the Docs tab is NOT the empty state — verify what it really renders.
    await expect(page.getByRole('button', { name: 'Upload spec' })).toBeVisible();
    await expect(page.getByText('Conventional commits')).toBeVisible();

    // Skills / MCP starts genuinely empty — that tab IS the teaching empty state. The copy now names
    // the real dead end rather than just the absence: nothing in the app can create a skill yet, so a
    // reindex will not fill this list either (ADR 0312's empty-picker pass).
    //? Renamed in the fix-round: the tab is "Capabilities / MCP" (the other "Skills" are the instruction blocks).
    await page.getByRole('tab', { name: /Capabilities \/ MCP/ }).click();
    await expect(page.getByText(/No skills or MCP tools/)).toBeVisible();
  });

  test('scheduled renders its empty tasks teaching state', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Scheduled ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    await page.goto('/workspaces/develop/scheduled');
    // Scheduled's title is a styled <div>, not a semantic heading — match on text instead.
    await expect(page.getByText('Scheduled tasks', { exact: true })).toBeVisible();
    await expect(page.getByText('Nothing scheduled yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New scheduled task' })).toBeVisible();
  });
});

test.describe('code', () => {
  test('code browser shows its setup/empty state for a fresh Agency workspace', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Code ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    await page.goto('/workspaces/develop/code');

    // The Agency pack turns Development on, so the Code section is reachable (not nav-gated). A
    // fresh workspace has no linked repo yet, so it always lands on the "no repository" setup
    // notice — verify that actual default rather than assuming the section itself is hidden.
    await expect(page.getByRole('heading', { name: 'Code' })).toBeVisible();
    await expect(page.getByText('No repository linked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link a repository' })).toBeVisible();
  });
});
