//? Workspaces — Playwright fixture foundation for deterministic core-flow specs.
//?
//? `authedPage`: a Page whose BROWSER CONTEXT already carries a valid session cookie for a
//? brand-new throwaway credentials user, registered directly over HTTP through the Vite dev
//? origin (same contract `tests/e2e/httpControl.test.mts` drives against the raw backend) —
//? `POST /auth/api/credentials` with `{ email, password, name, confirmPassword, provider }`.
//? `context.request` shares its cookie jar with `page`, so the `Set-Cookie` from registration
//? is already present on the very first `page.goto()` — no manual `context.addCookies` needed.
//? A fresh user belongs to zero workspaces, so the first render is always Onboarding
//? (`src/workspaces/_shell/Onboarding.tsx`) — use the `createWorkspace` helper below to get past it.
//?
//? testid convention for anyone extending this suite (data-testid="ws-<page>-<element>"):
//?   - Selector priority: getByRole / getByLabel / getByPlaceholder / getByTitle (existing
//?     accessible attributes) FIRST. Reach for getByTestId only when a role/label selector is
//?     genuinely ambiguous — and then only inside a page folder you own; this foundation adds
//?     none (see auth-onboarding.spec.ts / nav.spec.ts for the structural locators used instead).
//?   - Every data-testid added anywhere must be exercised by at least one spec — no speculative tagging.
//?
//? Cleanup: NOT performed by these specs. Each throwaway user + the workspace it onboards into
//? (with its starter-seed tickets/members) is left in dev Mongo — a real "delete workspace" flow
//? exists (src/workspaces/workspace/page.tsx DangerTab, type-to-confirm) but wiring it into every
//? spec was out of scope for this foundation; a future spec can add it. Emails are tagged
//? `e2e-pw-<...>@test.local` so leftover rows are easy to find/purge (`prisma.user.deleteMany({
//? where: { email: { startsWith: 'e2e-pw-' } } })`).

import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';

import { ports } from '../../config.ports';

export { expect };

const ORIGIN = `http://localhost:${String(ports.frontend)}`; // dev public origin (Vite) — passes the origin gate
const PASSWORD = 'Test1234!aA'; // upper + lower + digit + special, len 11 — satisfies the default password policy

//? Unique email per call so parallel specs/workers never collide on the same user.
export function freshEmail(tag: string): string {
  return `e2e-pw-${tag}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

//? Registers a throwaway credentials user (CSRF-exempt route) and lets `context.request`'s
//? shared cookie jar carry the resulting session into `page`. Small retry/back-off: the register
//? route is rate-limited and several spec files may register within the same window.
export async function registerAndAuth(context: BrowserContext, email: string): Promise<void> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await context.request.post(`${ORIGIN}/auth/api/credentials`, {
      headers: { Origin: ORIGIN },
      data: { email, password: PASSWORD, name: 'E2E Tester', confirmPassword: PASSWORD, provider: 'credentials' },
    });
    lastStatus = res.status();
    if (res.ok()) {
      const body = (await res.json()) as { status?: boolean; authenticated?: boolean };
      if (body.status === true && body.authenticated === true) return;
    }
    await new Promise((r) => { setTimeout(r, 400 * (attempt + 1)); }); // back off (429 or a transient failure)
  }
  throw new Error(`registerAndAuth: /auth/api/credentials never succeeded for ${email} (last status ${String(lastStatus)})`);
}

//? Drives the zero-workspace Onboarding screen (src/workspaces/_shell/Onboarding.tsx): picks the
//? Agency pack (all four modules — development/content/design/documents) then submits the name
//? via Enter, exactly like a real user. Assumes `page` is already showing Onboarding.
export async function createWorkspace(page: Page, name: string): Promise<void> {
  const nameInput = page.getByPlaceholder('Workspace name…');
  await expect(nameInput).toBeVisible();
  await page.getByRole('button', { name: /Agency \/ client work/i }).click();
  await nameInput.fill(name);
  await nameInput.press('Enter');
}

interface WsFixtures {
  authedPage: Page;
}

//? `authedPage` — a Page pre-authenticated as a brand-new throwaway user (zero workspaces) that
//? has already navigated to `/workspaces` (-> WorkspacesIndex's `<Navigate>` to
//? `/workspaces/develop/board`, where Onboarding renders until a workspace exists).
//? NOTE: goes straight to `/workspaces`, not `/` — the root `src/page.tsx` redirect middleware
//? (session-authenticated -> `loginRedirectUrl`) did not fire in this dev environment during
//? investigation (confirmed via console/network logging: the session loads correctly over the
//? socket, but the URL never leaves `/`); `/workspaces` is the same destination and works
//? reliably, so the fixture uses it directly. Flagging the `/` behaviour for the app owner rather
//? than fixing it here — outside this task's scope (a Playwright fixture foundation).
export const test = base.extend<WsFixtures>({
  authedPage: async ({ page, context }, use) => {
    await registerAndAuth(context, freshEmail('auth'));
    await page.goto('/workspaces');
    await use(page);
  },
});
