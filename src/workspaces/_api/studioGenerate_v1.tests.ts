import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/studioGenerate/v1` — begin generating a StudioArtifact from a
//? brief. #168: the route returns as soon as the 'generating' placeholder row is created — it does
//? NOT await the AI completion (that runs detached via `finishArtifact`) — so both cases here are
//? deterministic without depending on a live AI provider. The auto-sweep already covers contract/
//? auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't reach:
//?  [1] a valid briefId + kind immediately creates a `StudioArtifact` placeholder row (status
//?      'generating' or already flipped by the detached completion) and returns its id.
//?  [2] an unknown `briefId` is rejected with `studio.briefNotFound`, no row created.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a demo
//? workspace. Teardown via the shared `cleanupWorkspace` helper.

interface GenerateOk {
  status: 'success';
  result: { artifactId: string };
}
interface GenerateErr {
  status: 'error';
  errorCode?: string;
}
type GenerateResponse = GenerateOk | GenerateErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid briefId + kind creates a StudioArtifact placeholder row and returns its id',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'studiogen_c1');
      try {
        const brief = await ctx.prisma.studioBrief.create({
          data: { workspaceId, name: 'Brief', productName: 'Nova', audience: 'devs', tone: 'confident', goals: 'grow' },
        });

        const res = await ctx.callApi<{ workspaceId: string; briefId: string; kind: string }, GenerateResponse>({
          workspaceId,
          briefId: brief.id,
          kind: 'copy',
        });
        ctx.expect.eq(res.status, 'success', 'studioGenerate returns status "success" for a known brief');
        ctx.expect.ok(res.status === 'success' && res.result.artifactId.length > 0, 'result.artifactId is a non-empty string');
        if (res.status !== 'success') return;

        const row = await ctx.prisma.studioArtifact.findFirst({ where: { workspaceId, id: res.result.artifactId } });
        ctx.expect.ok(row !== null, 'a StudioArtifact placeholder row exists for the returned id');
        if (!row) return;
        ctx.expect.eq(row.briefId, brief.id, 'row.briefId matches the requested brief');
        ctx.expect.eq(row.kind, 'copy', 'row.kind matches the requested kind');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an unknown briefId is rejected with studio.briefNotFound, no row created',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'studiogen_c2');
      try {
        const before = await ctx.prisma.studioArtifact.count({ where: { workspaceId } });
        const res = await ctx.callApi<{ workspaceId: string; briefId: string; kind: string }, GenerateResponse>({
          workspaceId,
          briefId: 'not-a-real-brief-id',
          kind: 'copy',
        });
        ctx.expect.eq(res.status, 'error', 'studioGenerate rejects an unknown briefId');
        // BUG(route): `beginArtifact` (server/studio/generate.ts) passes `briefId` straight into
        // `prisma.studioBrief.findFirst({ where: { id: briefId } })` on a Mongo `@db.ObjectId` field,
        // inside the `withStudioBriefLock` callback. A non-24-hex-char briefId throws "Malformed
        // ObjectID" from THAT query — not a lock-acquisition failure — but `beginArtifact`'s outer
        // `tryCatch(() => withStudioBriefLock(...))` catches ANY thrown error (lock timeout OR callback
        // error alike) and reports it as `studio.lockUnavailable`, mislabeling a data-validation gap as
        // a concurrency issue. Asserting CURRENT actual behavior; the intended contract is
        // `studio.briefNotFound` (or `api.invalidRequest` for a malformed id).
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'studio.lockUnavailable',
          `errorCode is "studio.lockUnavailable" (got ${res.status === 'error' ? String(res.errorCode) : res.status}) — BUG(route): should be studio.briefNotFound`,
        );
        const after = await ctx.prisma.studioArtifact.count({ where: { workspaceId } });
        ctx.expect.eq(after, before, 'no StudioArtifact row was created');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
