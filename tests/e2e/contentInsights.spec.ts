//? Workspaces — Content module core-flow specs: overview render, a document create→edit→archive round
//? trip (the only mutating flow here — everything else is a render/navigation smoke check by design,
//? per the task's "no generation clicks" guard for marketing/studio since those cost real AI credits),
//? marketing/studio/scheduled-posts/insights/settings all render without error. Each test onboards its
//? own throwaway workspace via the shared `createWorkspace` fixture helper so specs never collide.
import { test, expect, createWorkspace } from './fixtures';
import type { Page } from '@playwright/test';

//? A hard `page.goto` straight to a deep workspace sub-route occasionally lands on a transient "no
//? workspaces yet" flash before the just-created workspace round-trips back over the socket (the same
//? class of race the fixture documents for `/`). A single reload clears it; every real assertion after
//? this call still fails loudly if the page is genuinely broken rather than just slow to hydrate.
async function gotoWs(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (await page.getByText('Welcome to Workspaces').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.reload();
    await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 20_000 });
  }
}

test('content overview renders with the board + primary action', async ({ authedPage }) => {
  const page = authedPage;
  await createWorkspace(page, `E2E PW Content Overview ${String(Date.now())}`);
  // A generous timeout here: createWorkspace's control-op round-trips through the Conductor, which can
  // be genuinely slow under concurrent load (shared dev backend) rather than actually broken.
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

  // Reach the Content overview through the nav rail (collapsed → icon-only, so the group's label lives
  // on a `title` attribute — same pattern as nav.spec.ts).
  await page.getByTitle('Content', { exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/content$/);

  // Page header + the one primary action (New content) are present; the board starts empty so the
  // teaching empty state (not the kanban columns) is what actually renders.
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible();
  // "New content" renders twice on an empty board — the header primary action + the empty state's
  // own action button — .first() targets the always-present header one.
  await expect(page.getByRole('button', { name: 'New content' }).first()).toBeVisible();
});

test('documents: create via UI, editor opens, archive it again', async ({ authedPage }) => {
  const page = authedPage;
  await createWorkspace(page, `E2E PW Documents ${String(Date.now())}`);
  // A generous timeout here: createWorkspace's control-op round-trips through the Conductor, which can
  // be genuinely slow under concurrent load (shared dev backend) rather than actually broken.
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

  await gotoWs(page, '/workspaces/content/documents');
  // The Documents page header is a plain styled div, not a heading element — match on its text.
  await expect(page.getByText('Documents', { exact: true })).toBeVisible();

  // Create: title → Create (Enter submits, exactly like the placeholder's onKeyDown handler).
  const docTitle = `E2E PW Doc ${String(Date.now())}`;
  const titleInput = page.getByPlaceholder('New document title…');
  await titleInput.fill(docTitle);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  // The new document card renders on the list.
  const docCard = page.getByText(docTitle, { exact: true });
  await expect(docCard).toBeVisible();

  // KNOWN APP BUG (reported, not fixed here per "report without auto-fixing"): the card's onClick calls
  // navigate(`documents/${id}`), which WorkspacesProvider's pathForView() resolves to
  // /workspaces/documents/<id> — missing the `content/` prefix the real file-based route
  // (src/workspaces/content/documents/[docId]/page.tsx -> /workspaces/content/documents/:docId) requires.
  // Clicking the card therefore 404s into the ErrorPage boundary instead of opening the editor. Until
  // that's fixed, read the id off the ws-documents-row-<id> testid (added for exactly this) and go to
  // the correct editor URL directly so the rest of this flow (editor + archive) is still exercised.
  const docRow = page.locator('[data-testid^="ws-documents-row-"]').filter({ has: docCard });
  const testId = await docRow.getAttribute('data-testid');
  const docId = testId?.replace('ws-documents-row-', '') ?? '';
  expect(docId).not.toBe('');
  await gotoWs(page, `/workspaces/content/documents/${docId}`);

  const editorTitle = page.getByLabel('Document title');
  await expect(editorTitle).toHaveValue(docTitle, { timeout: 20_000 });
  //? `exact: true`: the accessible name of an info "?" trigger now includes its own label (it used to
  //? be the bare glyph, which told a screen-reader user nothing), and one of them on this page reads
  //? "Exports use the saved version". A substring match on "Save" caught it — the selector was always
  //? ambiguous, the a11y fix just made it visible.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

  // Archive it again from the list: back to Documents, open the per-doc overflow menu, Archive.
  // (The Agency pack seeds starter documents, so the workspace is NOT empty — scope everything to
  // our own row via its testid rather than assuming uniqueness.)
  await page.getByRole('button', { name: 'Back to documents' }).click();
  await expect(page.getByText('Documents', { exact: true })).toBeVisible();
  await expect(docCard).toBeVisible();

  await docRow.getByRole('button', { name: 'Document actions' }).click();
  await docRow.getByRole('button', { name: 'Archive', exact: true }).click();

  // Archived docs are hidden by default; the card disappears from the visible (non-archived) list.
  await expect(docCard).toBeHidden();
  await expect(page.getByRole('button', { name: /Show archived \(\d+\)/ })).toBeVisible();
});

test('marketing renders (no generation clicks)', async ({ authedPage }) => {
  const page = authedPage;
  await createWorkspace(page, `E2E PW Marketing ${String(Date.now())}`);
  // A generous timeout here: createWorkspace's control-op round-trips through the Conductor, which can
  // be genuinely slow under concurrent load (shared dev backend) rather than actually broken.
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

  await gotoWs(page, '/workspaces/content/marketing');
  await expect(page.getByText('AI marketer: turn your product brief into marketing assets.')).toBeVisible();
  // No briefs yet — the teaching empty state (not the generate grid) is what should render.
  await expect(page.getByText('Marketing starts with a product brief')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create your first brief' })).toBeVisible();
});

test('studio renders (no generation clicks)', async ({ authedPage }) => {
  const page = authedPage;
  await createWorkspace(page, `E2E PW Studio ${String(Date.now())}`);
  // A generous timeout here: createWorkspace's control-op round-trips through the Conductor, which can
  // be genuinely slow under concurrent load (shared dev backend) rather than actually broken.
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

  await gotoWs(page, '/workspaces/content/studio');
  await expect(page.getByText('Describe your product once — generate everything')).toBeVisible();
});

test('scheduled-posts + content insights render', async ({ authedPage }) => {
  const page = authedPage;
  await createWorkspace(page, `E2E PW Insights ${String(Date.now())}`);
  // A generous timeout here: createWorkspace's control-op round-trips through the Conductor, which can
  // be genuinely slow under concurrent load (shared dev backend) rather than actually broken.
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

  await gotoWs(page, '/workspaces/content/scheduled-posts');
  // The Scheduled posts header is a plain styled div, not a heading element — match on its text.
  await expect(page.getByText('Scheduled posts', { exact: true })).toBeVisible();
  await expect(page.getByText('Nothing scheduled yet')).toBeVisible();

  await gotoWs(page, '/workspaces/content/insights');
  await expect(page.getByRole('heading', { name: 'Content insights' })).toBeVisible();
  // The always-visible at-a-glance stats row (fresh workspace → zero pieces everywhere) + default tab.
  await expect(page.getByText('Pieces', { exact: true })).toBeVisible();
  //? role="radio": the insights tab picker is a Segmented control (a radiogroup).
  await expect(page.getByRole('radio', { name: 'Performance' })).toBeVisible();
});

test('content settings route loads', async ({ authedPage }) => {
  const page = authedPage;
  await createWorkspace(page, `E2E PW Content Settings ${String(Date.now())}`);
  // A generous timeout here: createWorkspace's control-op round-trips through the Conductor, which can
  // be genuinely slow under concurrent load (shared dev backend) rather than actually broken.
  await expect(page.getByText('Welcome to Workspaces')).toBeHidden({ timeout: 30_000 });

  await gotoWs(page, '/workspaces/content/settings');
  await expect(page.getByRole('heading', { name: 'Content setup' })).toBeVisible();
  // Tabs render; Brand & styles is the default active tab.
  await expect(page.getByRole('tab', { name: 'Brand & styles' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Channels & publishing' })).toBeVisible();
});
