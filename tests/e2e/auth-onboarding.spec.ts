//? Workspaces — deterministic proof spec: a fresh throwaway user registers, lands on Onboarding
//? (zero workspaces), picks the Agency pack, and the board renders with the starter-seed tickets
//? (the same seeding contract `tests/e2e/httpControl.test.mts` asserts over raw HTTP — this spec
//? proves it through the actual browser UI instead).
import { test, expect, createWorkspace } from './fixtures';

test('a fresh user onboards with the Agency pack and the board renders seeded tickets', async ({ authedPage }) => {
  const page = authedPage;

  // Root -> /workspaces -> /workspaces/develop/board (WorkspacesIndex redirect), where a
  // zero-workspace user sees Onboarding instead of the shell.
  await expect(page).toHaveURL(/\/workspaces\/develop\/board$/);
  await expect(page.getByText('Welcome to Workspaces')).toBeVisible();

  await createWorkspace(page, `E2E PW Agency ${String(Date.now())}`);

  // Onboarding never navigates itself — the shell swaps Onboarding for the real board once the
  // Conductor has seeded the new workspace and the client's snapshot picks it up (async, so this
  // is a real wait, not a fixed sleep: `expect(...).toBeHidden()` polls until the timeout).
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

  // Ticket cards are the only `role="button"` elements on the board carrying a `.font-mono`
  // ticket-id span (the "+ Ticket" inline-add control and the nav rail are plain `<button>`s with
  // no such child) — a structural locator that needs no new data-testid on a page this spec
  // doesn't own.
  const ticketCards = page.locator('div[role="button"]').filter({ has: page.locator('span.font-mono') });
  await expect(ticketCards.first()).toBeVisible();
  expect(await ticketCards.count()).toBeGreaterThan(0);
});
