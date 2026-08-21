//? The owner, on /workspace/env: "de 2 input velden zijn niet goed ingesteld, de key input veld is 95%
//? van de lengte en de value maar 5% en als ik er in type zie ik niks gebeuren en als ik op save klik dan
//? word er ook geen value opgeslagen." And on /workspace/integrations: a way to actually test a tool.
//?
//? The width half is why this spec measures geometry instead of reading copy. The cause was a `w-full`
//? added to the shared field class for a different page, which silently outranked the `w-44` on the key
//? input — nothing about the markup looks wrong, no type or lint or translation check can see it, and the
//? only observable symptom is that one box is unusably narrow. A bounding box is the assertion that fails.
import { test, expect } from './fixtures';
import { createWorkspace } from './fixtures';

//? A closed port on localhost: the verdict is deterministic and no packet leaves the machine.
const DEAD_URL = 'postgres://127.0.0.1:9/app';

test.describe('env vars + integration tests', () => {
  test('both add-row boxes are usable, the value persists, and a secret says whether it is set', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Env ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    //? "Add variable" is fire-and-forget over the socket, so a reload issued in the same millisecond
    //? closes the transport before the write lands. A human never types that fast; a test does. Wait for
    //? the server's ack frame rather than sleeping. (Same pattern as skillsEditor/handoverPrompt.)
    const acked = new Promise<void>((resolve) => {
      page.on('websocket', (ws) => {
        ws.on('framereceived', (f) => {
          if (typeof f.payload === 'string' && f.payload.includes('saveEnv')) resolve();
        });
      });
    });

    await page.goto('/workspaces/workspace/env');
    const keyBox = page.getByPlaceholder('KEY');
    const valueBox = page.getByPlaceholder('value');
    await expect(keyBox).toBeVisible();
    await expect(valueBox).toBeVisible();

    const keyWidth = (await keyBox.boundingBox())?.width ?? 0;
    const valueWidth = (await valueBox.boundingBox())?.width ?? 0;
    expect(keyWidth).toBeGreaterThan(80);
    //? The reported symptom was ~5% of the row. The value box holds a connection string and must be the
    //? WIDER of the two; asserting merely "not tiny" would still pass the layout the owner complained about.
    expect(valueWidth).toBeGreaterThan(keyWidth);

    const KEY = `E2E_PROBE_${String(Date.now())}`;
    await keyBox.fill(KEY);
    await valueBox.fill(DEAD_URL);
    // Typing is visible: the field holds what was typed rather than clipping it away.
    await expect(valueBox).toHaveValue(DEAD_URL);

    await page.getByRole('button', { name: 'Add variable' }).click();
    await acked;
    await page.reload();

    //? The row survives a reload, and — the owner's actual doubt — it says a value IS stored. Before this,
    //? a saved secret and an empty one rendered the same ten dots.
    const row = page.getByText(KEY, { exact: true });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('set', { exact: true }).first()).toBeVisible();
  });

  test('an integration can be tested, and a dead address is reported as failed', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW Int ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    // A variable for the integration to point at.
    await page.goto('/workspaces/workspace/env');
    const KEY = `E2E_DEAD_${String(Date.now())}`;
    await page.getByPlaceholder('KEY').fill(KEY);
    await page.getByPlaceholder('value').fill(DEAD_URL);
    await page.getByRole('button', { name: 'Add variable' }).click();
    await expect(page.getByText(KEY, { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.goto('/workspaces/workspace/integrations');
    await page.getByRole('button', { name: 'Set up integration' }).click();
    // The form defaults to the first type (MongoDB) and names itself after it; only the mapping is left.
    await page.getByRole('button', { name: /Select an env var|— none —/ }).first().click();
    await page.getByText(KEY, { exact: true }).click();
    await page.getByRole('button', { name: 'Save integration' }).click();

    const testButton = page.getByRole('button', { name: 'Test' });
    await expect(testButton).toBeVisible({ timeout: 15_000 });
    await testButton.click();

    //? The verdict, not a toast: it lands on the row so the next visitor sees it too. "failed" because
    //? nothing is listening — a probe that answered "works" here would be the bug this feature prevents.
    await expect(page.getByText('failed', { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
