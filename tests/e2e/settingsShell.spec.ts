//? Workspaces — deterministic proof spec for the "settingsShell" surface: workspace settings
//? tabs (incl. the Git tab, and the Modules toggle-then-persist round trip), the three
//? Insights pages (Activity/Usage/Knowledge), the top-level account-settings page
//? (src/settings/page.tsx), and the workspace-switcher + sign-out flow in the nav rail.
//?
//? Selector priority throughout: getByRole / getByLabel / getByPlaceholder / getByTitle first.
//? The one `data-testid` used below (`ws-workspace-section-<id>`, added to every SectionsTab row
//? in src/workspaces/workspace/page.tsx; only the "documents" row is exercised here) exists only
//? because the per-section `Toggle` (../_components/primitives.tsx, out of this spec's owned
//? folders) renders a bare icon-only `<button>` with no accessible name — there is no
//? role/label/placeholder/title to hang a locator on, and a section label can collide with its
//? module's header text (e.g. "Content") so plain text isn't unambiguous either.
import type { Page } from '@playwright/test';

import { test, expect, createWorkspace } from './fixtures';

//? createWorkspace's default project is named after the workspace, so the ProjectSwitcher's
//? trigger (TopBar.tsx, right next to the workspace switcher) ends up with the SAME accessible
//? name as the workspace switcher's own trigger. The only DOM difference between the two is the
//? leading icon (workspace switcher: a one-letter avatar chip; ProjectSwitcher: a
//? `diagram-project` FontAwesome glyph) — filter it out rather than add a testid to Shell.tsx,
//? which this spec does not own.
function wsSwitcherButtons(page: Page, wsName: string) {
  return page.getByRole('button', { name: wsName }).filter({ hasNot: page.locator('[data-icon="diagram-project"]') });
}

//? Onboarding only clears once the Conductor has actually seeded the new workspace (async —
//? see auth-onboarding.spec.ts's comment on the same wait). Under a shared dev backend that can
//? occasionally run past the project's default 15s expect timeout, so this waits longer.
async function expectOnboarded(page: Page): Promise<void> {
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });
}

test.describe('settingsShell', () => {
  test('workspace settings tabs render, including the Git tab (labeled Git, not GitLab)', async ({ authedPage }) => {
    const page = authedPage;
    const wsName = `E2E PW Settings-Tabs ${String(Date.now())}`;
    await createWorkspace(page, wsName);
    await expectOnboarded(page);

    // Open the workspace switcher (button shows the active workspace's name, prefixed with a
    // one-letter avatar chip, hence a substring match rather than exact) then "Manage members".
    await wsSwitcherButtons(page, wsName).click();
    await page.getByRole('button', { name: 'Manage members' }).click();
    await expect(page).toHaveURL(/\/workspaces\/workspace$/);

    // The full admin tab strip (creator is Owner -> isAdmin -> all admin tabs) + the dev-lane
    // tabs (Repository/Git/Workflow) since the Agency pack turns Development on.
    //? role="tab", not "button": the tab strip is a real tablist (ADR 0312's accessibility pass).
    //? These assertions read as button-shaped because they predate that; the strip is the thing that
    //? became correct, so the selector follows it.
    for (const label of ['Members', 'Permissions', 'Modules', 'AI', 'Env', 'Integrations', 'Invites', 'Audit', 'Repository', 'Workflow', 'Danger zone']) {
      await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible();
    }
    // The Git tab specifically must read "Git", never "GitLab" (owner decision — forge is
    // provider-agnostic since GitHub support landed).
    const gitTab = page.getByRole('tab', { name: 'Git', exact: true });
    await expect(gitTab).toBeVisible();
    await expect(page.getByRole('tab', { name: 'GitLab', exact: true })).toHaveCount(0);

    // Click it: the panel underneath renders its own provider picker (unique text keeps this
    // assertion from colliding with the tab button that also happens to read "Git").
    await gitTab.click();
    await expect(page.getByText('Forge provider')).toBeVisible();
  });

  test('workspace settings Modules tab toggles a section and the change survives a reload', async ({ authedPage }) => {
    const page = authedPage;
    const wsName = `E2E PW Settings-Modules ${String(Date.now())}`;
    await createWorkspace(page, wsName);
    await expectOnboarded(page);

    await wsSwitcherButtons(page, wsName).click();
    await page.getByRole('button', { name: 'Manage members' }).click();
    await page.getByRole('tab', { name: 'Modules', exact: true }).click();

    // The Documents module resolves to exactly one section ("documents"), so toggling it off
    // is an unambiguous, single-section, still->=1-section-left change.
    const docsRow = page.getByTestId('ws-workspace-section-documents');
    await expect(docsRow).toBeVisible();
    //? The toggle is a `role="switch"`, so assert its ACCESSIBLE state rather than the class on an
    //? inner pill span. The old assertion tested styling internals and broke the moment the primitive
    //? gained a proper switch role — and a class name is not what a user or a screen reader perceives.
    const docsToggle = docsRow.getByRole('switch');
    // Toggle starts ON (Agency pack enables all 4 modules).
    await expect(docsToggle).toHaveAttribute('aria-checked', 'true');
    await docsToggle.click();
    await expect(docsToggle).toHaveAttribute('aria-checked', 'false');

    // The [save-sections] control-op fires over the existing socket (B-23 single-writer
    // Conductor) — a `page.reload()` issued before that request's frame is actually flushed can
    // tear the socket down mid-send and drop the write entirely (confirmed by hand: reloading
    // immediately never converges no matter how many times it's retried, while waiting for the
    // ack first is reliable every time). So this waits for the server's ack — a real network
    // event, not a fixed sleep — before reloading at all.
    await Promise.all([
      page.waitForEvent('console', { predicate: (msg) => msg.text().includes('Server Sync Response'), timeout: 10_000 }),
      page.getByRole('button', { name: 'Save sections', exact: true }).click(),
    ]);

    // Reload the whole app and navigate back into Modules — the server-resolved active
    // workspace + its persisted `enabledSections` must reflect the toggle-off.
    await page.reload();
    await expectOnboarded(page);
    await wsSwitcherButtons(page, wsName).click();
    await page.getByRole('button', { name: 'Manage members' }).click();
    await page.getByRole('tab', { name: 'Modules', exact: true }).click();
    const docsToggleAfterReload = page.getByTestId('ws-workspace-section-documents').getByRole('switch');
    await expect(docsToggleAfterReload).toHaveAttribute('aria-checked', 'false');
  });

  test('insights: Activity, Usage and Knowledge each render their own page', async ({ authedPage }) => {
    const page = authedPage;
    const wsName = `E2E PW Insights ${String(Date.now())}`;
    await createWorkspace(page, wsName);
    await expectOnboarded(page);

    // The rail starts collapsed (sub-items only render when expanded — see nav.spec.ts's
    // comment on the same rail), so Usage/Knowledge aren't independently clickable until the
    // rail is expanded via its always-visible collapse/expand pill.
    await page.getByTitle('Expand', { exact: true }).click();
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces\/insights\/activity$/);
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces\/insights\/usage$/);
    await expect(page.getByRole('heading', { name: 'Usage', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces\/insights\/knowledge$/);
    await expect(page.getByRole('heading', { name: 'Knowledge graph', exact: true })).toBeVisible();
  });

  test('account settings page (/settings) loads', async ({ authedPage }) => {
    const page = authedPage;
    // No workspace needed — /settings is the framework's own account page, reachable to any
    // logged-in user regardless of workspace membership.
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Password', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active sessions', exact: true })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  });

  test('workspace switcher lists the active workspace and sign-out returns to /login', async ({ authedPage }) => {
    const page = authedPage;
    const wsName = `E2E PW Switcher-SignOut ${String(Date.now())}`;
    await createWorkspace(page, wsName);
    await expectOnboarded(page);

    // Workspace switcher: the trigger (header) plus one popover row both carry the workspace's
    // name once open — two matches is itself proof the switcher lists the active workspace.
    const wsNameButtons = wsSwitcherButtons(page, wsName);
    await expect(wsNameButtons).toHaveCount(1); // closed: only the trigger
    await wsNameButtons.first().click();
    await expect(wsNameButtons).toHaveCount(2); // open: trigger + its own row in the popover
    await expect(page.getByRole('button', { name: 'Create workspace' })).toBeVisible();
    // Close the popover without navigating away (click the trigger again — DOM order puts it first).
    await wsNameButtons.first().click();
    await expect(wsNameButtons).toHaveCount(1);

    // Sign-out lives in the user dropdown at the bottom of the (collapsed) nav rail, opened via
    // the avatar button's title (`"<name> · settings"`, the only accessible handle while collapsed).
    await page.getByTitle(/settings$/i).click();
    const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
    await expect(signOut).toBeVisible();
    // The snapshot refresh can re-render the open user menu between Playwright's stability check and
    // pointer dispatch. Force skips only that transient animation check; the URL assertion proves effect.
    await Promise.all([
      page.waitForURL(/\/login$/),
      signOut.click({ force: true }),
    ]);
  });
});
