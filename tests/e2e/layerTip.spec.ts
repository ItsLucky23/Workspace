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

    await page.goto('/workspaces/workspace/aibehavior');
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


  test('the AI tab says how each backend is configured, and where', async ({ authedPage }) => {
    const page = authedPage;
    await createWorkspace(page, `E2E PW AiSetup ${String(Date.now())}`);
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

    await page.goto('/workspaces/workspace/aibehavior');

    //? Both backends listed with how they are set up. The page used to show a bare green/red dot, so
    //? "Claude is linked" was visible and where that came from was not — while the only settings on
    //? the page were Gemini's model and temperature, its KEY living on another page entirely.
    await expect(page.getByText(/the Claude CLI must be installed and signed in on the host/)).toBeVisible();
    await expect(page.getByText(/Needs a Google API key/)).toBeVisible();

    //? The Gemini rows are labelled as applying to one backend only — Claude has no model concept.
    await expect(page.getByText('Gemini only', { exact: true })).toBeVisible();

    //? And the absence is stated rather than left to be discovered by hunting for it.
    await expect(page.getByText(/no OpenAI\/GPT option yet/)).toBeVisible();

    //? Gemini's key IS reachable from here; Claude deliberately has no button, because there is
    //? nothing in the app to press — a button there would be the dead end this page already had.
    await page.getByRole('button', { name: 'Set the key' }).click();
    await expect(page).toHaveURL(/\/workspaces\/content\/settings\/admin$/);
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
