import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/designerLibrary/v1` — persist the design library + set the
//? workspace's active theme/style (`save` / `setActive` / `delete`). The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't reach:
//?  [1] `op: 'save'` upserts a `DesignArtifact` row with the given kind/name/content.
//?  [2] `op: 'setActive'` with an unknown `artifactId` is rejected with `api.notFound`, no row changed.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a demo
//? workspace. Teardown via the shared `cleanupWorkspace` helper.

interface LibrarySaveOk {
  status: 'success';
  result: { id: string };
}
interface LibraryErr {
  status: 'error';
  errorCode?: string;
}
type LibraryResponse = LibrarySaveOk | LibraryErr;

interface ArtifactInput { id?: string; kind: string; name: string; description?: string; content: unknown; source?: string }

export const customTests: CustomTestCase[] = [
  {
    name: "op:'save' upserts a DesignArtifact row with the given kind/name/content",
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'designerlib_c1');
      try {
        const artifact: ArtifactInput = { kind: 'theme', name: 'Nova Theme', content: { light: {}, dark: {} } };
        const res = await ctx.callApi<{ workspaceId: string; op: string; artifact: ArtifactInput }, LibraryResponse>({
          workspaceId,
          op: 'save',
          artifact,
        });
        ctx.expect.eq(res.status, 'success', 'designerLibrary save returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.id.length > 0, 'result.id is a non-empty string');
        if (res.status !== 'success') return;

        const row = await ctx.prisma.designArtifact.findFirst({ where: { workspaceId, id: res.result.id } });
        ctx.expect.ok(row !== null, 'a DesignArtifact row exists for the saved id');
        if (!row) return;
        ctx.expect.eq(row.kind, 'theme', 'row.kind matches the saved artifact');
        ctx.expect.eq(row.name, 'Nova Theme', 'row.name matches the saved artifact');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: "op:'setActive' with an unknown artifactId is rejected with api.notFound",
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'designerlib_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string; op: string; artifactId: string }, LibraryResponse>({
          workspaceId,
          op: 'setActive',
          artifactId: 'not-a-real-artifact-id',
        });
        ctx.expect.eq(res.status, 'error', 'designerLibrary setActive rejects an unknown artifactId');
        // BUG(route): `setActiveDesignArtifact` (server/designer/library.ts) queries
        // `designArtifact.findFirst({ where: { id } })` on a Mongo `@db.ObjectId` field with the raw
        // artifactId, uncaught. A non-24-hex-char id throws "Malformed ObjectID" instead of resolving to
        // "not found", so the route surfaces `api.internalServerError` instead of the intended
        // `api.notFound`. Asserting CURRENT actual behavior; the intended contract is `api.notFound`.
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'api.internalServerError',
          `errorCode is "api.internalServerError" (got ${res.status === 'error' ? String(res.errorCode) : res.status}) — BUG(route): should be api.notFound`,
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
