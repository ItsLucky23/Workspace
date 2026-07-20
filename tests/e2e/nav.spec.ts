//? Workspaces — deterministic proof spec: the Develop/Content/Insights nav-rail groups
//? (src/workspaces/_shell/Shell.tsx NavRail) each navigate to their first destination, and the
//? URL follows the category/view structure documented in src/workspaces/_data/nav.ts
//? (/workspaces/<category>/<view>, with Content's overview doubling as its own category index).
import { test, expect, createWorkspace } from './fixtures';

test('the Develop / Content / Insights nav groups navigate to their category URLs', async ({ authedPage }) => {
  const page = authedPage;
  await createWorkspace(page, `E2E PW Nav ${String(Date.now())}`);
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

  // Starts on the Develop group's default destination (the board).
  await expect(page).toHaveURL(/\/workspaces\/develop\/board$/);

  // The nav rail starts collapsed (WorkspacesShell's `expanded` state defaults to false), so each
  // group button carries its label as a `title` attribute instead of visible text — getByTitle
  // reads that existing accessible attribute directly, no new data-testid needed.
  await page.getByTitle('Content', { exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/content$/);

  await page.getByTitle('Insights', { exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/insights\/activity$/);

  await page.getByTitle('Develop', { exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/develop\/board$/);
});
