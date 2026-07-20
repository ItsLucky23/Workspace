import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/studioDelete/v1` — delete a brief (+ its artifacts) or a single
//? artifact. The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert the
//? business-logic the sweep can't reach:
//?  [1] `artifactId` deletes exactly that `StudioArtifact` row, leaving the brief intact.
//?  [2] `briefId` deletes the brief AND cascades to delete its `StudioArtifact` rows.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a demo
//? workspace. Teardown via the shared `cleanupWorkspace` helper.

interface DeleteOk {
  status: 'success';
  result: { ok: true };
}
interface DeleteErr {
  status: 'error';
  errorCode?: string;
}
type DeleteResponse = DeleteOk | DeleteErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'artifactId deletes exactly that StudioArtifact row, leaving the brief intact',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'studiodel_c1');
      try {
        const brief = await ctx.prisma.studioBrief.create({
          data: { workspaceId, name: 'Brief', productName: 'Nova', audience: 'devs', tone: 'confident', goals: 'grow' },
        });
        const artifact = await ctx.prisma.studioArtifact.create({
          data: { workspaceId, briefId: brief.id, kind: 'copy', role: 'marketer', title: 'Copy', content: { sections: [] }, status: 'ready' },
        });

        const res = await ctx.callApi<{ workspaceId: string; artifactId: string }, DeleteResponse>({
          workspaceId,
          artifactId: artifact.id,
        });
        ctx.expect.eq(res.status, 'success', 'studioDelete returns status "success" for a known artifact');
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true');

        const artifactRow = await ctx.prisma.studioArtifact.findFirst({ where: { workspaceId, id: artifact.id } });
        ctx.expect.ok(artifactRow === null, 'the StudioArtifact row was deleted');
        const briefRow = await ctx.prisma.studioBrief.findFirst({ where: { workspaceId, id: brief.id } });
        ctx.expect.ok(briefRow !== null, 'the StudioBrief row is untouched');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'briefId deletes the brief AND cascades to delete its StudioArtifact rows',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'studiodel_c2');
      try {
        const brief = await ctx.prisma.studioBrief.create({
          data: { workspaceId, name: 'Brief', productName: 'Nova', audience: 'devs', tone: 'confident', goals: 'grow' },
        });
        const artifact = await ctx.prisma.studioArtifact.create({
          data: { workspaceId, briefId: brief.id, kind: 'copy', role: 'marketer', title: 'Copy', content: { sections: [] }, status: 'ready' },
        });

        const res = await ctx.callApi<{ workspaceId: string; briefId: string }, DeleteResponse>({
          workspaceId,
          briefId: brief.id,
        });
        ctx.expect.eq(res.status, 'success', 'studioDelete returns status "success" for a known brief');
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true');

        const briefRow = await ctx.prisma.studioBrief.findFirst({ where: { workspaceId, id: brief.id } });
        ctx.expect.ok(briefRow === null, 'the StudioBrief row was deleted');
        const artifactRow = await ctx.prisma.studioArtifact.findFirst({ where: { workspaceId, id: artifact.id } });
        ctx.expect.ok(artifactRow === null, 'the cascaded StudioArtifact row was deleted');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
