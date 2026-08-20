//? The owner: "nu kunnen we een message met variabelen maar dit lijkt mij niet handig en ook to much om
//? telkens op te zetten, misschien per stage gewoon een prompt die runt op het eind van iedere sessie".
//?
//? So the Carry-over tab lost its `{{summary}}` chips and its slot template, and gained one plain field:
//? what this stage hands to the next one. Two things worth clicking rather than assuming: the chips are
//? actually gone from the screen (a removed feature that still renders is the worst outcome), and the
//? new field persists — the same "Save stage" path that silently dropped a write in the skills spec.
import { test, expect } from './fixtures';
import { createWorkspace } from './fixtures';

const HANDOVER = 'Tell the next stage which acceptance criteria are still unproven.';

test.describe('handover prompt', () => {
  test('the carry-over tab is one plain field, and it survives a reload', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Handover ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    //? Fire-and-forget over the socket with no confirmation in the UI, so a reload straight after the
    //? click races the write. Wait for the server's ack frame. (Same reason as skillsEditor.spec.)
    const acked = new Promise<void>((resolve) => {
      page.on('websocket', (ws) => {
        ws.on('framereceived', (f) => {
          if (typeof f.payload === 'string' && f.payload.includes('saveStageConfig')) resolve();
        });
      });
    });

    await page.goto('/workspaces/develop/pipeline/refined/carryover');
    const field = page.getByPlaceholder('In plain language: what does the next stage need to know from you?');
    await expect(field).toBeVisible();

    // The slot machinery is gone, not merely hidden behind something.
    await expect(page.getByText('{{summary}}')).toHaveCount(0);
    await expect(page.getByText('Incoming variables')).toHaveCount(0);

    // A seeded stage arrives with a real default rather than an empty box.
    await expect(field).not.toHaveValue('');

    await field.fill(HANDOVER);
    await page.getByRole('button', { name: /Save stage/ }).click();
    await acked;

    await page.reload();
    await expect(page.getByPlaceholder('In plain language: what does the next stage need to know from you?')).toHaveValue(HANDOVER, { timeout: 15_000 });
  });
});
