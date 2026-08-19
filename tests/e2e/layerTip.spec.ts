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

    //? Scoped to the persona label's own row: the page header carries its own "?" (validate), and
    //? every trigger shares the accessible name by design, so a page-wide .first() picks the wrong one.
    //? FieldLabel renders `<div class="flex items-center gap-1.5"><span>title</span>{info}</div>`.
    const personaRow = page.getByText('AI persona (system prompt)', { exact: true }).locator('xpath=..');
    await personaRow.getByRole('button', { name: /More information/ }).first().click();
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

    await page.getByRole('button', { name: /More information/ }).first().click();
    await expect(page.getByText('How this prompt is composed')).toBeVisible();
    // The stage layers live on the pipeline, and the tip says so with a way to get there.
    await expect(page.getByRole('button', { name: /Edit on the General tab/ }).first()).toBeVisible();
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
