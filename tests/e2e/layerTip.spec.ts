//? The "?" the owner asked for: a small icon beside a layered field that reveals, on demand, where
//? that field sits in the composed prompt and where the other layers are edited.
//?
//? What shipped first was a full-width block ON TOP of the field on /pipeline, and on
//? /workspace/aibehavior the same block four settings rows BELOW the field — present, unfindable, and
//? the opposite of the request on the one screen it was asked for. Nothing caught that, because no
//? check had ever opened one of these tooltips. This spec opens them.
import { test, expect } from './fixtures';
import { createWorkspace } from './fixtures';

test.describe('layer tip', () => {
  test('the pipeline persona field carries a "?" that reveals the layers and links away', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW LayerTip ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/develop/pipeline');
    await expect(page.getByText('AI persona (system prompt)', { exact: true })).toBeVisible();

    // The explanation is BEHIND the icon, not on the page: nothing is showing before the click.
    await expect(page.getByText('How this prompt is composed')).toBeHidden();

    //? HOVER, not click: on a fine-pointer device the tip opens on hover and its click is a no-op by
    //? design — clicking an already-open tip used to toggle it shut, so the only way to reach the
    //? contents was click-to-close then click-to-open. Asserting a click here would assert that bug.
    //?
    //? Scoped to the persona label's own row: the page header carries its own "?" (validate), and
    //? every trigger shares the accessible name by design, so a page-wide .first() picks the wrong one.
    //? FieldLabel renders `<div class="flex items-center gap-1.5"><span>title</span>{info}</div>`.
    const personaRow = page.getByText('AI persona (system prompt)', { exact: true }).locator('xpath=..');
    await personaRow.getByRole('button', { name: /More information/ }).first().hover();
    await expect(page.getByText('How this prompt is composed')).toBeVisible();

    //? Scoped to the popover: the inline note under the field also says "after Workspace instruction",
    //? and matching both would prove nothing about what the popover contains.
    const tip = page.getByRole('dialog', { name: 'More information' });
    // It names the OTHER layers of the same channel — the thing a user cannot see anywhere else.
    await expect(tip.getByText('1. Workspace instruction')).toBeVisible();

    // And it is a way OUT: the workspace layer is edited on another page entirely.
    await tip.getByRole('button', { name: /Edit in workspace AI settings/ }).click();
    await expect(page).toHaveURL(/\/workspaces\/workspace\/aibehavior$/);
  });

  test('the workspace AI persona field carries the same "?"', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW LayerTipWs ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/workspace/aibehavior/instructions');
    await expect(page.getByText('Workspace instruction').first()).toBeVisible();
    await expect(page.getByText('How this prompt is composed')).toBeHidden();

    await page.getByRole('button', { name: /More information/ }).first().hover();
    await expect(page.getByText('How this prompt is composed')).toBeVisible();
    // The stage layers live on the pipeline, and the tip says so with a way to get there.
    await expect(page.getByRole('button', { name: /Edit on the General tab/ }).first()).toBeVisible();
  });


  test('hover opens it, the pointer can travel into it, clicking the icon does nothing', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW TipHover ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/workspace/aibehavior');
    const trigger = page.getByRole('button', { name: /More information/ }).first();
    const tip = page.getByRole('dialog', { name: 'More information' });

    await expect(tip).toBeHidden();
    await trigger.hover();
    await expect(tip).toBeVisible();

    //? Clicking the icon must NOT close it. It used to toggle, and since a click is necessarily
    //? preceded by a hover that already opened the tip, the click shut it again — so reaching the
    //? contents took click-to-close then click-to-open. (This is why the assertion is "still visible"
    //? rather than "never opens": you cannot click something without hovering it first.)
    await trigger.click();
    await expect(tip).toBeVisible();

    //? The panel renders in a floating layer OUTSIDE the trigger's wrapper. Hovering something inside
    //? it is the exact move that used to dismiss it mid-travel; it must survive and stay reachable.
    await tip.getByRole('button', { name: /Edit on the General tab/ }).first().hover();
    await expect(tip).toBeVisible();

    //? …and it does close once the pointer is genuinely away — a tip that never leaves is its own bug.
    //? The grace period is 500ms, so this waits past it rather than racing it.
    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden({ timeout: 5000 });

    //? An outside CLICK dismisses it without out-waiting the grace period.
    //?
    //? Dispatched, not clicked: a real click first MOVES the pointer off the trigger, which starts the
    //? 500ms close timer, so the tip would disappear on its own and the assertion would pass whether
    //? or not outside-click works at all. Dispatching mousedown leaves the pointer where it is, so the
    //? only thing that can close the panel here is the layer's outside-click handler.
    await trigger.hover();
    await expect(tip).toBeVisible();
    await page.getByRole('heading', { level: 1 }).first().dispatchEvent('mousedown');
    await expect(tip).toBeHidden({ timeout: 2000 });
  });


  test('connected AIs are a list you manage: connect, test, disconnect — no endpoint field', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW AiConn ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    //? ADR 0312 — the page is sectioned like the Repository tab, so the backends live at their own
    //? address rather than five panels down a single column.
    await page.goto('/workspaces/workspace/aibehavior/backends');
    await expect(page).toHaveURL(/\/aibehavior\/backends$/);

    //? A fresh workspace has connected nothing — and says so, rather than showing panels that imply
    //? a backend is set up. The page used to hardcode a Gemini panel and an OpenAI panel.
    await expect(page.getByText(/No AI connected yet/)).toBeVisible();

    //? The add form is generated from the server catalog, so every backend is offered — including the
    //? subscription one, which the owner could previously read about but never connect.
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();

    //? Subscription vs API key is a real split, asserted where it is load-bearing: the connected list
    //? groups by it (below, after connecting). The picker also labels each option with its kind, but
    //? that text lives inside the Dropdown's trigger and is not worth coupling a test to.

    //? The endpoint is NOT a field anywhere on this page: which host answers is infrastructure.
    await expect(page.getByText('Endpoint', { exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder(/https:\/\//)).toHaveCount(0);

    // Connect the SUBSCRIPTION backend: no key, no model — the form must not demand either.
    await page.getByRole('button', { name: 'Connect' }).click();
    const row = page.getByText(/Runs on the server\. Test asks whether the CLI/);
    await expect(row).toBeVisible({ timeout: 15_000 });

    //? The list groups by kind, so a subscription and a metered key are never read as the same thing.
    //? Scoped to the uppercase group header: 'Subscription' also appears as the coding-agent seat
    //? label on this page since ADR 0322.
    await expect(page.locator('.uppercase', { hasText: 'Subscription' })).toBeVisible();

    //? Test and Disconnect are the two verbs the owner asked for, on the row itself.
    await expect(page.getByRole('button', { name: 'Test', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();

    //? Disconnecting confirms first, and the dialog states what happens to the configuration.
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText(/will no longer be used by this workspace/)).toBeVisible();
  });

  test('the full composed-text block no longer sits on top of the fields it describes', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW LayerOrder ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/develop/pipeline');
    //? Order in the DOM is the claim: the field the user came to edit must come first. This is the
    //? layout complaint made testable, so it cannot quietly come back.
    const persona = page.getByText('AI persona (system prompt)', { exact: true });
    const preview = page.getByRole('button', { name: /What the AI actually receives/ });
    await expect(persona).toBeVisible();
    await expect(preview).toBeVisible();
    const order = await persona.evaluate((el, other) => {
      const pos = el.compareDocumentPosition(other as Node);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? 'after' : 'before';
    }, await preview.elementHandle());
    expect(order, 'the composed-text block comes AFTER the fields').toBe('after');
  });
});
