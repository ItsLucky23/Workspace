//? Workspaces — deterministic proof specs for the "boardTicket" core flow: create a ticket
//? from the board, work its card menu (pause-agent's no-repo warning, archive + destructive
//? confirm), open a ticket and switch its five tabs (Review renders its empty state), and the
//? Backlog list + quick filters. Each test onboards its own throwaway workspace via the shared
//? `authedPage` + `createWorkspace` fixture so specs never share state.
//?
//? testids used here (both newly added, both inside owned folders — see the file:line notes
//? on their definitions):
//?   - `ws-board-new-ticket` (src/workspaces/develop/board/BoardHeader.tsx) — disambiguates the
//?     header's "+ Ticket" primary action from the Unrefined column's inline quick-add button,
//?     which renders the exact same accessible name ("Ticket").
//?   - `ws-backlog-row` (src/workspaces/develop/backlog/page.tsx) — the backlog Row has no
//?     role/label of its own and nests inside ancestor elements that also carry a font-mono id
//?     span, so the board's structural has()-locator trick would over-match here.
import { test, expect, createWorkspace } from './fixtures';

//? Board ticket cards: the same structural locator auth-onboarding.spec.ts / nav.spec.ts use —
//? a `role="button"` card carrying a `.font-mono` id span (KanbanCard.tsx), which nothing else
//? on the board matches. No new testid needed on a page this spec doesn't own beyond board/.
const ticketCards = (page: import('@playwright/test').Page) =>
  page.locator('div[role="button"]').filter({ has: page.locator('span.font-mono') });

//? Drives the "+ Ticket" header form (BoardHeader.tsx NewTicketForm): title-only, Create button.
async function createTicket(page: import('@playwright/test').Page, title: string): Promise<void> {
  await page.getByTestId('ws-board-new-ticket').getByRole('button', { name: 'Ticket', exact: true }).click();
  const titleInput = page.getByPlaceholder('Ticket title…');
  await expect(titleInput).toBeVisible();
  await titleInput.fill(title);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
}

test.describe('board', () => {
  test('+ Ticket creates a card that lands in Unrefined', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW BoardCreate ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    const title = `E2E create ${String(Date.now())}`;
    await createTicket(page, title);

    const card = ticketCards(page).filter({ hasText: title });
    await expect(card).toBeVisible();
  });

  test('card menu opens and pause-agent warns about the unlinked repo', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW BoardPause ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    // A freshly created ticket is guaranteed status 'idle' (never 'paused'), so its card menu
    // reliably shows "Pause agent" rather than "Resume agent" (cardMenuItems, KanbanCard.tsx).
    const title = `E2E pause ${String(Date.now())}`;
    await createTicket(page, title);
    const card = ticketCards(page).filter({ hasText: title });
    await expect(card).toBeVisible();

    // The ⋯ trigger has no `ariaLabel` prop on the board card → PopMenu's default aria-label
    // "menu" (primitives.tsx). Scoped to this card so it doesn't collide with other cards' menus.
    await card.getByRole('button', { name: 'menu' }).click();
    await card.getByRole('button', { name: 'Pause agent', exact: true }).click();

    // A fresh workspace has no linked repository, so the guard fires instead of pausing
    // (KanbanCard.tsx cardMenuItems) — a sonner toast, rendered outside the card's DOM.
    await expect(page.getByText(/No agent can run yet/i)).toBeVisible();
  });

  test('archive via card menu + destructive confirm removes the card from the board', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW BoardArchive ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    const title = `E2E archive ${String(Date.now())}`;
    await createTicket(page, title);
    const card = ticketCards(page).filter({ hasText: title });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'menu' }).click();
    await card.getByRole('button', { name: 'Archive', exact: true }).click();

    // menuHandler.confirm renders ConfirmMenu (src/_components/ConfirmMenu.tsx) outside the
    // card's DOM — its Confirm button carries the shared "confirm.confirm" i18n key.
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();

    // Board.tsx filters `t.archived === true` out of every column — the card must disappear.
    await expect(card).toHaveCount(0);
  });
});

test.describe('ticket page', () => {
  test('tabs switch between overview/code/terminal/review/activity, and Review renders its empty state', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Ticket ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    const title = `E2E ticket detail ${String(Date.now())}`;
    await createTicket(page, title);
    const card = ticketCards(page).filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/workspaces\/develop\/board\/[^/]+$/);

    // Overview is the default tab — its Description card renders immediately.
    await expect(page.getByText('Description', { exact: true })).toBeVisible();

    // Tab names ("Activity", "Code", …) collide with an unrelated `role="complementary"` panel
    // elsewhere on the page (see the `ws-ticket-tabs` note at its definition) — every click below
    // is scoped to that wrapper instead of a bare page-wide accessible-name query.
    const tabs = page.getByTestId('ws-ticket-tabs');

    // A brand-new ticket has no linked files/branch/stage-processes yet, so every non-Overview
    // tab lands on a deterministic, data-independent empty state — no seeded fixtures needed.
    await tabs.getByRole('tab', { name:'Code', exact: true }).click();
    await expect(page.getByText('No file changes yet')).toBeVisible();

    await tabs.getByRole('tab', { name:'Terminal', exact: true }).click();
    await expect(page.getByText('No terminal running')).toBeVisible();

    await tabs.getByRole('tab', { name:'Review', exact: true }).click();
    await expect(page.getByText('No branch yet')).toBeVisible();

    await tabs.getByRole('tab', { name:'Activity', exact: true }).click();
    // The create event may arrive in the snapshot before or after navigation; these disclosures are
    // the stable Activity-panel contract regardless of whether its feed is empty or already populated.
    await expect(page.getByRole('button', { name: 'Related tickets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stage history' })).toBeVisible();

    await tabs.getByRole('tab', { name:'Overview', exact: true }).click();
    await expect(page.getByText('Description', { exact: true })).toBeVisible();
  });
});

test.describe('backlog', () => {
  test('list renders every seeded ticket and the quick filters narrow the results', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Backlog ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden();

    // Direct URL navigation (same pattern the `authedPage` fixture itself uses for
    // `/workspaces`) — the workspace is already onboarded server-side, so a fresh load of the
    // Backlog route re-bootstraps against the same session/workspace without going through the
    // collapsed nav rail's expand → group → sub-item chain.
    await page.goto('/workspaces/develop/backlog');
    await expect(page.getByRole('heading', { name: 'Backlog', exact: true })).toBeVisible();

    const rows = page.getByTestId('ws-backlog-row');
    await expect(rows.first()).toBeVisible();
    const totalCount = await rows.count();
    expect(totalCount).toBeGreaterThan(0);

    // No AI turn has ever run in this fresh workspace, so no ticket can be 'needs-input' —
    // filtering to it deterministically empties the list (no live-AI dependency, per the
    // no-AI-chat guard on this suite).
    //? role="radio": the quick filters are a Segmented control (a radiogroup), not loose buttons.
    await page.getByRole('radio', { name: 'Needs input', exact: true }).click();
    await expect(page.getByText('No tickets match')).toBeVisible();
    await expect(rows).toHaveCount(0);

    await page.getByRole('radio', { name: 'All', exact: true }).click();
    await expect(rows.first()).toBeVisible();
    await expect(rows).toHaveCount(totalCount);
  });
});
