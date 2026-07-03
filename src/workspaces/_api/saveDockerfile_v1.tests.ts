import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `workspaces/saveDockerfile/v1` — persist the reviewed draft
//? `.workspaces/Dockerfile`. The auto-sweep covers contract/auth/rate-limit/fuzz; these
//? cases assert the business rule the sweep can't reach:
//?  [1] a valid draft (first FROM = the L1 base) is accepted (result.ok = true).
//?  [2] a draft whose first FROM is NOT the base is REJECTED (ok = false, invalidBase) —
//?      the supply-chain guard that must survive user edits, not just generation.
//?  [3] an empty draft is rejected (ok = false, empty).
//?
//? Integration: a throwaway first-login user (Owner of the seeded workspace, so it holds
//? workspaceSettings) drives the route; the draft file + every seeded row are torn down in
//? a `finally` so nothing leaks.

import { rmSync } from 'node:fs';
import path from 'node:path';

interface SaveOk { status: 'success'; result: { ok: boolean; error?: string } }
interface SaveErr { status: 'error'; errorCode?: string }
type SaveResponse = SaveOk | SaveErr;

//? The base the draft must extend — read from env so the test tracks a custom WS_BASE_IMAGE.
const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';

const uniqueEmail = (tag: string): string => `lstest_savedockerfile_${tag}_${String(Date.now())}_${String(Math.floor(Math.random() * 1e6))}@youcomm.nl`;

//? Tear down everything the first-login seed created for `userId` (mirrors the Conductor's
//? private `cascadeDeleteWorkspace`), then the throwaway login user.
async function cleanupUser(db: TestContext['prisma'], userId: string): Promise<void> {
  const memberships = await db.workspaceMember.findMany({ where: { userId } });
  const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
  for (const workspaceId of workspaceIds) {
    const members = await db.workspaceMember.findMany({ where: { workspaceId } });
    const demoUserIds = members.map((m) => m.userId).filter((id) => id !== userId);
    await db.ticketEvent.deleteMany({ where: { workspaceId } });
    await db.ticket.deleteMany({ where: { workspaceId } });
    await db.workspaceSuggestion.deleteMany({ where: { workspaceId } });
    await db.workspaceBudget.deleteMany({ where: { workspaceId } });
    await db.workspaceSignal.deleteMany({ where: { workspaceId } });
    await db.sprint.deleteMany({ where: { workspaceId } });
    await db.infoSource.deleteMany({ where: { workspaceId } });
    await db.envVar.deleteMany({ where: { workspaceId } });
    await db.integrationTool.deleteMany({ where: { workspaceId } });
    await db.invite.deleteMany({ where: { workspaceId } });
    await db.pipelineStage.deleteMany({ where: { workspaceId } });
    await db.workspaceRole.deleteMany({ where: { workspaceId } });
    await db.workspaceMember.deleteMany({ where: { workspaceId } });
    await db.project.deleteMany({ where: { workspaceId } });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
    //? Remove any draft.Dockerfile this test wrote under data/workspaces/<id>/.
    rmSync(path.join(process.cwd(), 'data', 'workspaces', workspaceId), { recursive: true, force: true });
    if (demoUserIds.length > 0) await db.user.deleteMany({ where: { id: { in: demoUserIds } } });
  }
  await db.user.deleteMany({ where: { id: userId } });
}

async function seededWorkspaceId(ctx: TestContext, userId: string): Promise<string | undefined> {
  const member = await ctx.prisma.workspaceMember.findFirst({ where: { userId } });
  return member?.workspaceId;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid draft (first FROM = the L1 base) is accepted',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c1') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        const res = await ctx.callApi<{ workspaceId: string; dockerfile: string }, SaveResponse>({
          workspaceId, dockerfile: `FROM ${BASE_IMAGE}\nRUN echo ok\n`,
        });
        ctx.expect.eq(res.status, 'success', 'save returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true for a base-extending draft');
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
  {
    name: 'a draft whose first FROM is not the base is rejected (invalidBase)',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c2') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        const res = await ctx.callApi<{ workspaceId: string; dockerfile: string }, SaveResponse>({
          workspaceId, dockerfile: 'FROM ubuntu:22.04\nRUN echo nope\n',
        });
        ctx.expect.ok(res.status === 'success', 'route resolves (the rejection is in result, not a throw)');
        ctx.expect.ok(
          res.status === 'success' && !res.result.ok && res.result.error === 'dockerfile.invalidBase',
          'an arbitrary FROM is rejected with error "dockerfile.invalidBase"',
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
  {
    name: 'an empty draft is rejected (empty)',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c3') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        const res = await ctx.callApi<{ workspaceId: string; dockerfile: string }, SaveResponse>({
          workspaceId, dockerfile: '   \n  ',
        });
        ctx.expect.ok(
          res.status === 'success' && !res.result.ok && res.result.error === 'dockerfile.empty',
          'a whitespace-only draft is rejected with error "dockerfile.empty"',
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
];
