import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/generateDocs/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach:
//?  [1] the demo-seeded project has no linked repo (no bare clone on disk), so
//?      `generateProjectDoc` deterministically short-circuits on `repoManifests` returning
//?      an empty tree BEFORE any AI-provider call — `{ ok: false, error: 'repo.notLinked' }`
//?      — this is the only deterministic path this route has without a live provider + a
//?      real linked repo. `seedDemoWorkspace` ALWAYS seeds a starter `project-summary`
//?      InfoSource (same `name` the generator writes to on success — `docsGen.ts` `update`s
//?      it in place), so a plain "no row exists" check is wrong here; the real contract on
//?      this failure path is that the seeded row is left UNTOUCHED (verified via its
//?      unchanged `updatedAt`), since `generateProjectDoc` returns before reaching the DB
//?      write at all.
//?  [2] a member WITHOUT `editPipeline` (the built-in 'member' role) is rejected with
//?      `auth.forbidden`.
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace (owner
//? role, full perms — including `editPipeline`), logs in as the owner. Case [2] creates a
//? second real member with the built-in 'member' role (no editPipeline) directly via
//? `ctx.prisma.workspaceMember`. Teardown via `cleanupWorkspace`.

interface GenerateDocsOk {
  status: 'success';
  result: { ok: boolean; name: string; content: string; error?: string };
}
interface GenerateDocsErr {
  status: 'error';
  errorCode: string;
}
type GenerateDocsResponse = GenerateDocsOk | GenerateDocsErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'an editPipeline member on a project with no linked repo gets repo.notLinked, no doc persisted',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'gendocs_c1');
      try {
        const before = await ctx.prisma.infoSource.findFirst({ where: { workspaceId, mode: 'context-doc', name: 'project-summary' } });
        ctx.expect.ok(before !== null, 'the demo seed already provides a starter "project-summary" InfoSource');

        const res = await ctx.callApi<{ workspaceId: string }, GenerateDocsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'generateDocs returns status "success" (the envelope) even on the repo-not-linked path');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.ok, false, 'result.ok is false — the demo project has no linked repo');
        ctx.expect.eq(res.result.error, 'repo.notLinked', 'result.error is "repo.notLinked"');

        const after = await ctx.prisma.infoSource.findFirst({ where: { workspaceId, mode: 'context-doc', name: 'project-summary' } });
        ctx.expect.eq(
          after?.updatedAt.getTime(),
          before?.updatedAt.getTime(),
          'the seeded "project-summary" InfoSource is untouched (same updatedAt) — generation failed before reaching the DB write',
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a member without editPipeline is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'gendocs_c2');
      const { createRealUser } = await import('../../../tests/_helpers.mjs');
      const member = await createRealUser(ctx.prisma, 'gendocs_c2_member');
      try {
        await ctx.prisma.workspaceMember.create({ data: { workspaceId, userId: member.id, roleKey: 'member' } });
        await ctx.session.login({ id: member.id, email: member.email, name: member.name });
        const res = await ctx.callApi<{ workspaceId: string }, GenerateDocsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'generateDocs rejects a member without editPipeline');
        if (res.status !== 'error') return;
        ctx.expect.eq(res.errorCode, 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, member.id]);
      }
    },
  },
];
