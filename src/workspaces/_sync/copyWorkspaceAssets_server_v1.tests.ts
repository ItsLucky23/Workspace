import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/copyWorkspaceAssets/v1` — copies the user-authored styles +
//? brand kit from a SOURCE workspace into the active one (FREEDOM_PROGRAM R2). The Conductor also
//? authorizes the caller's membership on the source side (not just RBAC on the active workspace).
//?  [1] happy path — a caller who is a member of BOTH workspaces copies a non-builtin StylePreset
//?      from the source into the active workspace (Prisma post-condition).
//?  [2] boundary — the caller is a member of the ACTIVE workspace (so RBAC passes) but NOT of the
//?      claimed source workspace: the Conductor no-ops (the route acks success either way — it does
//?      not surface the inner source-membership check as an error — see conductor.ts `copy-workspace-assets`),
//?      so we assert nothing was copied instead of asserting on the ack status.

interface CopyAssetsInput {
  sourceWorkspaceId: string;
  clientRequestId: string;
}
interface CopyAssetsOk {
  status: 'success';
}
interface CopyAssetsErr {
  status: 'error';
  errorCode: string;
}
type CopyAssetsResponse = CopyAssetsOk | CopyAssetsErr;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path copies a non-builtin style from the source workspace (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'copyassets_c1');
      const source = await loginSeededUser(ctx, 'copyassets_c1_source');
      const styleKey = `custom-${String(Date.now())}`;
      try {
        //? Seed a user-authored (non-builtin) style in the SOURCE workspace to copy.
        await ctx.prisma.stylePreset.create({
          data: { workspaceId: source.workspaceId, feature: 'image-gen', key: styleKey, label: 'Custom copy-test style', systemPrompt: 'a distinctive test prompt', builtin: false },
        });
        //? The caller must be a member of BOTH workspaces — log back in as the acting user and
        //? grant it membership on the source too (the inner authorize-copy-from check).
        await ctx.session.login({ id: userId });
        await ctx.prisma.workspaceMember.create({ data: { workspaceId: source.workspaceId, userId, roleKey: 'member' } });
        await joinRoom(ctx, workspaceId);

        const res = await ctx.callSync<CopyAssetsInput, CopyAssetsResponse>(
          { sourceWorkspaceId: source.workspaceId, clientRequestId: `cwa-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'copyWorkspaceAssets returns status "success"');

        const copied = await poll(() => ctx.prisma.stylePreset.findFirst({ where: { workspaceId, key: styleKey, builtin: false } }));
        ctx.expect.ok(copied !== null, 'the Conductor copied the style into the active workspace');
        ctx.expect.eq(copied?.systemPrompt, 'a distinctive test prompt', 'the copied style keeps its content');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
        await cleanupWorkspace(ctx.prisma, source.workspaceId, [source.userId]);
      }
    },
  },
  {
    name: 'a caller who is not a member of the claimed source workspace copies nothing',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'copyassets_c2');
      const source = await loginSeededUser(ctx, 'copyassets_c2_source');
      const styleKey = `custom-${String(Date.now())}`;
      try {
        await ctx.prisma.stylePreset.create({
          data: { workspaceId: source.workspaceId, feature: 'image-gen', key: styleKey, label: 'Should not be copied', systemPrompt: 'should not appear', builtin: false },
        });
        //? Log back in as the acting user (RBAC-privileged on the ACTIVE workspace only —
        //? deliberately NOT added as a member of the source workspace).
        await ctx.session.login({ id: userId });
        await joinRoom(ctx, workspaceId);

        await ctx.callSync<CopyAssetsInput, CopyAssetsResponse>(
          { sourceWorkspaceId: source.workspaceId, clientRequestId: `cwa-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );

        const copied = await ctx.prisma.stylePreset.findFirst({ where: { workspaceId, key: styleKey, builtin: false } });
        ctx.expect.ok(copied === null, 'nothing was copied for a caller with no source-workspace membership');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
        await cleanupWorkspace(ctx.prisma, source.workspaceId, [source.userId]);
      }
    },
  },
];
