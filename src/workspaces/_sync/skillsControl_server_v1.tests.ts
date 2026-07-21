import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/skillsControl/v1` — the universal AI-skills layer (the
//? instruction Skill rows, distinct from the capability/context-doc `skill-toggle` route), whitelisted to
//? `SKILL_OPS`. Covers:
//?  [1] happy path — `ai-skill-save` (no `skillId` → create) dispatched through the Conductor;
//?      asserted via the real Prisma post-condition (a new `Skill` row), not just the ack.
//?  [2] the op whitelist itself — an op outside `SKILL_OPS` is rejected with
//?      `sync.invalidRequest` before it ever reaches the Conductor/RBAC.

interface SkillsControlInput {
  op: string; clientRequestId: string;
  skillId?: string; name?: string; instruction?: string; examples?: string;
  applyPoints?: string[]; enabled?: boolean; on?: boolean;
}
interface SkillsControlOk { status: 'success' }
interface SkillsControlErr { status: 'error'; errorCode: string }
type SkillsControlResponse = SkillsControlOk | SkillsControlErr;

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
    name: 'happy path: ai-skill-save (no skillId) creates a Skill row (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'skillscontrol_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Sync harness skill ${String(Date.now())}`;
        const res = await ctx.callSync<SkillsControlInput, SkillsControlResponse>(
          { op: 'ai-skill-save', clientRequestId: `sc-c1-${String(Date.now())}`, name, instruction: 'Do the thing.', enabled: true },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'skillsControl returns status "success"');

        const skill = await poll(() => ctx.prisma.skill.findFirst({ where: { workspaceId, name } }));
        ctx.expect.ok(skill !== null, 'the Conductor persisted the Skill (post-condition, not just the ack)');
        ctx.expect.eq(skill?.instruction, 'Do the thing.', 'the persisted skill carries the instruction we sent');
        ctx.expect.eq(skill?.builtin, false, 'a newly created skill is never a builtin');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an op outside the skill-op whitelist is rejected before reaching the Conductor',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'skillscontrol_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SkillsControlInput, SkillsControlResponse>(
          { op: 'content-create', clientRequestId: `sc-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an op outside SKILL_OPS is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected with sync.invalidRequest (whitelist check), not auth/Conductor error');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
