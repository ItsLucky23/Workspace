import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/seoSuggest/v1` — the SEO title-scoring + suggestion read. The
//? auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert the business-logic
//? the sweep can't reach:
//?  [1] an empty `title` is rejected with `api.invalidRequest` BEFORE any DB/AI work — this is the
//?      route's own `.trim()`-then-length guard, ahead of the generic sweep's `typeof` contract check.
//?  [2] a non-member of the workspace (valid input otherwise) is rejected with `auth.forbidden` via
//?      the `CAP.workTickets` capability gate.
//?  [3] a member gets the DETERMINISTIC scoring contract for a known weak title — `scoreTitle` is a
//?      pure function (`server/content/seo.ts`) so `result.score` / `result.issues` / `result.lengthOk`
//?      are exact regardless of whether the AI rewrite call succeeds; the route always returns
//?      `status: 'success'` even when the provider call fails (the deterministic score must never be
//?      unavailable), so this case is a real, provider-state-agnostic happy path.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId — the harness's
//? synthetic `test-user-<ts>` fallback is NOT a valid ObjectId and breaks the route's `@db.ObjectId`
//? membership query on `user.id`), logs in as it, then explicitly seeds a demo workspace (first-login
//? auto-seed was removed in commit 42632a2 — onboarding now owns the zero-workspace path). Teardown
//? via the shared `cleanupWorkspace` harness helper.

interface SeoOk {
  status: 'success';
  result: {
    score: number;
    issues: string[];
    lengthOk: boolean;
    titles: string[];
    description: string;
    tags: string[];
    aiOk: boolean;
  };
}
interface SeoErr {
  status: 'error';
  errorCode: string;
}
type SeoResponse = SeoOk | SeoErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'an empty title is rejected with api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'seoSuggest_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; title: string }, SeoResponse>({
          workspaceId, title: '   ',
        });
        ctx.expect.eq(res.status, 'error', 'an empty/whitespace title is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', `errorCode is api.invalidRequest, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member of the workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'seoSuggest_c2');
      const outsider = await ctx.prisma.user.create({ data: { email: `lstest_seoSuggest_c2_outsider_${String(Date.now())}@youcomm.nl`, name: 'Outsider' } });
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name ?? 'Outsider' });
        const res = await ctx.callApi<{ workspaceId: string; title: string }, SeoResponse>({
          workspaceId, title: 'A perfectly fine title',
        });
        ctx.expect.eq(res.status, 'error', 'a non-member gets an error response');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', `errorCode is auth.forbidden, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a member gets the deterministic score for a known weak title, regardless of the AI rewrite outcome',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'seoSuggest_c3');
      try {
        //? "hi" on youtube: too short (<15 chars, -15) + no hook (no digit/?/how-why-what-when, -15) →
        //? score 70, lengthOk true (within the 60-char limit even though short).
        const res = await ctx.callApi<{ workspaceId: string; title: string; platform?: string }, SeoResponse>({
          workspaceId, title: 'hi', platform: 'youtube',
        });
        ctx.expect.eq(res.status, 'success', 'seoSuggest always returns status "success" — the deterministic score never depends on the AI call');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.score, 70, 'deterministic score for "hi" on youtube is 70');
        ctx.expect.ok(res.result.issues.includes('seo.tooShort'), 'issues includes seo.tooShort');
        ctx.expect.ok(res.result.issues.includes('seo.noHook'), 'issues includes seo.noHook');
        ctx.expect.eq(res.result.lengthOk, true, 'lengthOk is true (2 chars is within the 60-char youtube limit)');
        ctx.expect.ok(Array.isArray(res.result.titles), 'result.titles is an array');
        ctx.expect.ok(Array.isArray(res.result.tags), 'result.tags is an array');
        ctx.expect.ok(typeof res.result.description === 'string', 'result.description is a string');
        ctx.expect.ok(typeof res.result.aiOk === 'boolean', 'result.aiOk is a boolean');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
