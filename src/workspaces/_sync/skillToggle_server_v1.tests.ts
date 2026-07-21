import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/skillToggle/v1` — enable/disable a canonical capability Skill.
//? Covers:
//?  [1] happy path — toggling a seeded capability off; asserted via the real Prisma
//?      post-condition (`Skill.enabled`), not just the ack.
//?  [2] the route's own input validation — an empty `sourceId` is rejected with
//?      `sync.invalidRequest` before it ever reaches the Conductor.

interface SkillToggleInput { sourceId: string; on: boolean; clientRequestId: string }
interface SkillToggleOk { status: 'success'; sourceId: string; on: boolean }
interface SkillToggleErr { status: 'error'; errorCode: string }
type SkillToggleResponse = SkillToggleOk | SkillToggleErr;

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
    name: 'happy path: toggling a seeded capability Skill off persists (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'skilltoggle_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const source = await ctx.prisma.skill.findFirst({ where: { workspaceId, skillType: 'capability' } });
        ctx.expect.ok(source !== null, 'the seeded demo workspace ships at least one capability Skill');
        if (!source) return;

        const res = await ctx.callSync<SkillToggleInput, SkillToggleResponse>(
          { sourceId: source.id, on: false, clientRequestId: `st-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'skillToggle returns status "success"');

        const updated = await poll(async () => {
          const row = await ctx.prisma.skill.findFirst({ where: { workspaceId, id: source.id, skillType: 'capability' } });
          return row && !row.enabled ? row : null;
        });
        ctx.expect.ok(updated !== null, 'the Conductor persisted enabled=false (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an empty sourceId is rejected by the route\'s own input validation',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'skilltoggle_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SkillToggleInput, SkillToggleResponse>(
          { sourceId: '', on: true, clientRequestId: `st-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an empty sourceId is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected with sync.invalidRequest by the route\'s own guard');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
