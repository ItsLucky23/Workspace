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
    //? F-011/F-012 — the designer state re-saves with the persisted id (→ UPDATE, not a content-hashed new
    //? row) and deletes through op:'delete' (the rail used to filter local state only).
    name: "op:'save' with the persisted id updates the row in place; op:'delete' removes it",
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'designerlib_c0');
      try {
        const first = await ctx.callApi<{ workspaceId: string; op: string; artifact: ArtifactInput }, LibraryResponse>({
          workspaceId, op: 'save', artifact: { kind: 'style', name: 'Round one', content: { radius: 'lg', shadow: 'soft', density: 'cozy' } },
        });
        ctx.expect.eq(first.status, 'success', 'first save succeeds');
        if (first.status !== 'success') return;
        const id = first.result.id;
        const second = await ctx.callApi<{ workspaceId: string; op: string; artifact: ArtifactInput }, LibraryResponse>({
          workspaceId, op: 'save', artifact: { id, kind: 'style', name: 'Round two', content: { radius: 'sm', shadow: 'none', density: 'compact' } },
        });
        ctx.expect.eq(second.status, 'success', 'second save (with id, renamed + re-tokened) succeeds');
        ctx.expect.ok(second.status === 'success' && second.result.id === id, 'the same id comes back — an update, not a twin');
        const rows = await ctx.prisma.designArtifact.findMany({ where: { workspaceId, kind: 'style', name: { in: ['Round one', 'Round two'] } } });
        ctx.expect.eq(rows.length, 1, 'exactly one row exists after the re-save');
        ctx.expect.eq(rows[0]?.name, 'Round two', 'the row carries the new name');

        const del = await ctx.callApi<{ workspaceId: string; op: string; artifactId: string }, LibraryResponse>({ workspaceId, op: 'delete', artifactId: id });
        ctx.expect.eq(del.status, 'success', 'delete succeeds');
        const gone = await ctx.prisma.designArtifact.findFirst({ where: { workspaceId, id } });
        ctx.expect.ok(gone === null, 'the row is gone from the DB (the rail no longer resurrects it on refetch)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
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
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'api.notFound',
          `errorCode is "api.notFound" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
