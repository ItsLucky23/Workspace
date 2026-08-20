//? The owner: "iedere skill goed kan inzien met een simpele editor ... en het toevoegen van skills moet
//? ook via die code editor gaan", plus "je hoeft de skills nooit aan te zetten maar je kan ze bij de
//? pipeline stages aan of uit zetten".
//?
//? Both halves are behaviour, and both replace something that LOOKED present: a skill's whole text was
//? squeezed into a six-row box on a card, "add" was a second, poorer form that could not set examples or
//? scope, and the on/off switch sat two pages away from the stage it affected — so a skill could read as
//? "on" and still contribute nothing. Copy checks would pass on all of that. This spec clicks it.
import { test, expect } from './fixtures';
import { createWorkspace } from './fixtures';

const NAME = 'E2E Pirate skill';
const TEXT = 'Always answer like a pirate, but keep the facts exact.';

test.describe('skills editor', () => {
  test('a skill is written, re-opened, renamed and deleted in one editor', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Skills ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/workspace/aibehavior/skills');
    await page.getByRole('button', { name: 'New skill' }).click();

    //? The whole object in ONE form — this is the half that did not exist: an added skill could not be
    //? given a scope until it had been saved and re-opened.
    await page.getByLabel('Name').fill(NAME);
    await page.getByLabel('Instruction').fill(TEXT);
    await page.getByRole('switch', { name: 'Chat' }).click();
    await page.getByRole('button', { name: 'Save skill' }).click();

    // Back in the list, with its scope stated rather than an on/off dot that means nothing.
    await expect(page.getByText(NAME)).toBeVisible();
    await expect(page.getByText('Runs in: Chat')).toBeVisible();

    // Re-opening shows the FULL text, not a truncated preview.
    await page.getByText(NAME).click();
    await expect(page.getByLabel('Instruction')).toHaveValue(TEXT);

    await page.getByLabel('Name').fill(`${NAME} v2`);
    await page.getByRole('button', { name: 'Save skill' }).click();
    await expect(page.getByText(`${NAME} v2`)).toBeVisible();

    //? Delete goes through the confirm; the row is gone afterwards. (Reload first: the list is a
    //? snapshot read, and asserting on the optimistic view would not prove the write landed.)
    await page.getByText(`${NAME} v2`).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    //? Exact: the editor's own "Delete" button is still on screen behind the confirm dialog.
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.reload();
    await expect(page.getByText(`${NAME} v2`)).toBeHidden({ timeout: 15_000 });
  });

  test('a pipeline stage switches a skill on for itself, and it survives a reload', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW StageSkill ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/workspace/aibehavior/skills');
    await page.getByRole('button', { name: 'New skill' }).click();
    await page.getByLabel('Name').fill(NAME);
    await page.getByLabel('Instruction').fill(TEXT);
    //? Deliberately NO scope: this is the case the old model could not express at all — a skill that
    //? runs nowhere automatically but is picked by one stage.
    await page.getByRole('button', { name: 'Save skill' }).click();
    //? Scoped to THIS skill's row: the five builtins now seed unscoped too, so the bare text matches
    //? six rows — and an unscoped assertion would pass without the new skill existing at all.
    await expect(page.getByRole('button', { name: new RegExp(NAME) })).toContainText('Only where a pipeline stage picks it');

    //? "Save stage" is fire-and-forget over the socket and the page shows NO confirmation, so a
    //? reload issued straight after the click closes the transport mid-flight and the write is lost
    //? with `sync.notRoomMember`. Wait for the server's own ack frame instead of guessing a delay.
    const acked = new Promise<void>((resolve) => {
      page.on('websocket', (ws) => {
        ws.on('framereceived', (f) => {
          if (typeof f.payload === 'string' && f.payload.includes('saveStageConfig')) resolve();
        });
      });
    });

    await page.goto('/workspaces/develop/pipeline');
    await page.getByRole('tab', { name: 'Context' }).click();
    const row = page.getByRole('switch', { name: new RegExp(NAME) });
    await expect(row).toHaveAttribute('aria-checked', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-checked', 'true');

    // "Save stage" is the only persist path on this page — the reload is what proves it persisted.
    await page.getByRole('button', { name: /Save stage/ }).click();
    await acked;
    await page.reload();
    await page.getByRole('tab', { name: 'Context' }).click();
    await expect(page.getByRole('switch', { name: new RegExp(NAME) })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  });
});
