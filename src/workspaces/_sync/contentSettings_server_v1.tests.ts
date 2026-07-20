import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/contentSettings/v1` — the workspace-settings-scoped
//? content-op gateway (media budget / provider keys / styles, whitelisted to `SETTINGS_OPS`).
//? Covers:
//?  [1] happy path — `edit-media-budget` dispatched through the Conductor; asserted via the
//?      real Prisma post-condition (the `MediaBudget` row), not just the ack.
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and no budget row is written.

interface ContentSettingsInput {
  op: string; clientRequestId: string;
  capCents?: number; alertPct?: number; enabled?: boolean;
}
interface ContentSettingsOk { status: 'success' }
interface ContentSettingsErr { status: 'error'; errorCode: string }
type ContentSettingsResponse = ContentSettingsOk | ContentSettingsErr;

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
    name: 'happy path: edit-media-budget upserts the MediaBudget row (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentsettings_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const capCents = 12_345;
        const res = await ctx.callSync<ContentSettingsInput, ContentSettingsResponse>(
          { op: 'edit-media-budget', clientRequestId: `cs-c1-${String(Date.now())}`, capCents, alertPct: 90, enabled: true },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'contentSettings returns status "success"');

        const budget = await poll(() => ctx.prisma.mediaBudget.findFirst({ where: { workspaceId } }));
        ctx.expect.ok(budget !== null, 'the Conductor persisted the MediaBudget row (post-condition, not just the ack)');
        ctx.expect.eq(budget?.capCents, capCents, 'the persisted budget carries the capCents we sent');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentsettings_c2');
      const outsider = await createRealUser(ctx.prisma, 'contentsettings_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ContentSettingsInput, ContentSettingsResponse>(
          { op: 'edit-media-budget', clientRequestId: `cs-c2-${String(Date.now())}`, capCents: 999, enabled: true },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const budget = await ctx.prisma.mediaBudget.findFirst({ where: { workspaceId, capCents: 999 } });
        ctx.expect.ok(budget === null, 'no budget row was written for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
