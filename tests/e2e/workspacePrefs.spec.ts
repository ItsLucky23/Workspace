//? Workspaces — deterministic proof spec for the two panels ADR 0328 added, both of which are the FIRST
//? write path their setting ever had: the workspace time zone (Settings → Workspace) and the per-model
//? price map (Insights → Usage). Each test drives the panel the way an operator would and then RELOADS,
//? because the thing worth proving is not that the input accepted a value — it is that the value travelled
//? the whole control-API loop (route → RBAC → Conductor → Prisma → snapshot) and came back.
//?
//? Selector priority: getByRole / getByLabel / getByPlaceholder / getByTitle. No testids are needed here —
//? both panels were built with real labels (the price inputs carry a per-model aria-label, the zone picker
//? a SettingRow label), which is exactly what makes them reachable without one.
import type { Page } from '@playwright/test';

import { test, expect, createWorkspace } from './fixtures';

//? Onboarding only clears once the Conductor has seeded the new workspace (async — same wait as
//? settingsShell.spec.ts / auth-onboarding.spec.ts).
async function expectOnboarded(page: Page): Promise<void> {
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });
}

//? Both panels write over the socket via a [control-API] op, and the Conductor's write is off-thread — a
//? reload issued before the write lands drops it (settingsShell.spec.ts documents the same trap). That spec
//? waits on a "Server Sync Response" console event, which is fine when it is the only thing talking; here it
//? is NOT — these tests run in parallel against a shared dev backend and the page's own snapshot refreshes
//? emit the same line, so that wait can be satisfied by an unrelated response and reload too early.
//?
//? So each test waits on CONTENT that only the server can produce instead. `saveWorkspacePrefs` is
//? deliberately not optimistic and echoes back the STORED value, which makes that wait available for free —
//? and it is a stronger assertion than an ack, because it proves what was stored, not merely that something
//? answered.

//? Settings is deliberately NOT in the nav rail (Shell.tsx filters it out of NAV_BOTTOM; it hangs off the
//? user dropdown instead), and the tab is a URL trail segment — so the tab IS addressable, and navigating
//? to it directly beats clicking through a menu this spec does not own.
async function openWorkspaceSettingsTab(page: Page): Promise<void> {
  await page.goto('/workspaces/settings/workspace');
  await expect(page.getByRole('tab', { name: 'Workspace', exact: true })).toHaveAttribute('aria-selected', 'true');
}

test.describe('workspacePrefs', () => {
  test('the workspace time zone can be picked and survives a reload', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Timezone ${String(Date.now())}`);
    await expectOnboarded(page);
    await openWorkspaceSettingsTab(page);

    // The panel is deliberately FIRST in the tab: it silently changes what every other date means.
    await expect(page.getByText('Workspace time zone', { exact: true })).toBeVisible();
    //? The help line renders the CURRENT time in the selected zone. It is the panel's whole point — a zone
    //? name means nothing to most people, a clock reading confirms they picked the right one — so assert the
    //? shape rather than a value (the actual time changes by definition).
    await expect(page.getByText(/It is .+ here right now\./)).toBeVisible();

    //? Asia/Tokyo on purpose: far enough from any European host clock that a date-line bug shows up as a
    //? different DAY, not a different hour.
    //? The trigger is located structurally rather than by its current value: a fresh workspace does NOT
    //? start on UTC (it inherits a real zone at bootstrap), so matching on the displayed zone would tie this
    //? test to whatever the host happens to be. The zone picker is this tab's only listbox trigger.
    const trigger = page.locator('[aria-haspopup="listbox"]');
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    await page.getByPlaceholder('Search a zone').fill('Asia/Tokyo');
    await page.getByRole('option', { name: 'Asia/Tokyo', exact: true }).click();
    //? The picker is not optimistic: it renders the zone the SERVER stored. So this line only turns true
    //? once the op has been through the Conductor and come back — it is both the wait and the proof.
    await expect(trigger).toContainText('Asia/Tokyo');

    // The whole point: it came back from the server, not from React state.
    await page.reload();
    await expectOnboarded(page);
    await openWorkspaceSettingsTab(page);
    await expect(page.getByText('Asia/Tokyo').first()).toBeVisible();
    //? And the "Use <your zone>" shortcut now appears, because the stored zone finally differs from the
    //? browser's — proof the panel is reading the STORED value and not its own default.
    await expect(page.getByRole('button', { name: /^Use / })).toBeVisible();
  });

  test('a model price can be added, saved and survives a reload', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Pricing ${String(Date.now())}`);
    await expectOnboarded(page);

    await page.getByTitle('Expand', { exact: true }).click();
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await expect(page).toHaveURL(/\/workspaces\/insights\/usage$/);

    // The panel is a collapsed Disclosure — it sits above the budgets that spend this money.
    await page.getByText('Model pricing', { exact: true }).click();
    await expect(page.getByText('What one thousand tokens costs per model.', { exact: false })).toBeVisible();

    //? A model name the catalog will never list, so the row under test is unambiguously the one this test
    //? added (a real model id could also be contributed by whichever backends the host has connected).
    const model = 'e2e-priced-model';
    await page.getByLabel('Add a model', { exact: true }).fill(model);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const priceInput = page.getByLabel(`Price per 1k tokens for ${model}`, { exact: true });
    await expect(priceInput).toBeVisible();
    //? Typed with trailing zeros ON PURPOSE. The server stores a NUMBER, and the panel re-seeds its inputs
    //? from the stored map, so `1.2500` visibly normalises to `1.25` at exactly the moment the round trip
    //? completes. That gives this test a server-produced signal to wait on instead of a generic socket ack.
    await priceInput.fill('1.2500');
    await page.getByRole('button', { name: 'Save prices', exact: true }).click();
    await expect(priceInput).toHaveValue('1.25');

    await page.reload();
    await expectOnboarded(page);
    await page.getByTitle('Expand', { exact: true }).click();
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await page.getByText('Model pricing', { exact: true }).click();

    //? The row is present after the reload ONLY because the price is stored: rows are derived from the
    //? stored map plus the backend catalog, and this id is in neither unless the write landed.
    await expect(page.getByLabel(`Price per 1k tokens for ${model}`, { exact: true })).toHaveValue('1.25');
  });

  test('a price of 0 is stored as free, not discarded as empty', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Pricing-Zero ${String(Date.now())}`);
    await expectOnboarded(page);

    await page.getByTitle('Expand', { exact: true }).click();
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await page.getByText('Model pricing', { exact: true }).click();

    //? The distinction the panel's own help text promises: an EMPTY field falls back to the host price,
    //? while 0 means the model genuinely costs nothing (a subscription seat). Storing 0 as "unset" would
    //? silently re-bill a free model at the host rate, which is the bug this asserts against.
    const model = 'e2e-free-model';
    await page.getByLabel('Add a model', { exact: true }).fill(model);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const priceInput = page.getByLabel(`Price per 1k tokens for ${model}`, { exact: true });
    await priceInput.fill('0.00');
    await page.getByRole('button', { name: 'Save prices', exact: true }).click();
    //? `0.00` → `0` proves the round trip AND that 0 survived it: a 0 treated as "empty" would come back as
    //? an absent key, and the row would fall back to the placeholder instead.
    await expect(priceInput).toHaveValue('0');

    await page.reload();
    await expectOnboarded(page);
    await page.getByTitle('Expand', { exact: true }).click();
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await page.getByText('Model pricing', { exact: true }).click();
    await expect(page.getByLabel(`Price per 1k tokens for ${model}`, { exact: true })).toHaveValue('0');
  });
});
