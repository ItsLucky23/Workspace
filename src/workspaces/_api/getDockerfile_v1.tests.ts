import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `workspaces/getDockerfile/v1` — read the persisted draft so the
//? review UI survives a reload. The auto-sweep covers contract/auth/rate-limit/fuzz; these
//? cases assert the read behaviour the sweep can't reach:
//?  [1] with no draft yet → ok = false, error "dockerfile.noDraft".
//?  [2] after a draft is written → ok = true, the exact bytes come back.
//?
//? Integration: a throwaway first-login user (Owner, so it holds workspaceSettings) drives
//? the route; the draft is seeded via the same server helper the save route uses, and the
//? draft file + every seeded row are torn down in a `finally`.

import { rmSync } from 'node:fs';
import path from 'node:path';
import { saveDockerfileDraft } from '../../../server/container/dockerfileDraft';

interface GetOk { status: 'success'; result: { ok: boolean; dockerfile: string; error?: string } }
interface GetErr { status: 'error'; errorCode?: string }
type GetResponse = GetOk | GetErr;

const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';

const uniqueEmail = (tag: string): string => `lstest_getdockerfile_${tag}_${String(Date.now())}_${String(Math.floor(Math.random() * 1e6))}@youcomm.nl`;

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
    name: 'with no draft yet, returns ok=false / dockerfile.noDraft',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c1') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        const res = await ctx.callApi<{ workspaceId: string }, GetResponse>({ workspaceId });
        ctx.expect.ok(
          res.status === 'success' && !res.result.ok && res.result.error === 'dockerfile.noDraft',
          'a workspace with no generated draft reports "dockerfile.noDraft"',
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
  {
    name: 'after a draft is written, returns ok=true with the exact bytes',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c2') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        //? R3-b — the draft is per-project; seed + read the workspace's first project's slot.
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seed created a project');
        if (!project) return;
        const draft = `FROM ${BASE_IMAGE}\nRUN echo persisted\n`;
        const saved = saveDockerfileDraft(workspaceId, project.id, draft);
        ctx.expect.ok(saved.ok, 'seeding the draft via saveDockerfileDraft succeeds');
        const res = await ctx.callApi<{ workspaceId: string }, GetResponse>({ workspaceId });
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true once a draft exists');
        ctx.expect.ok(
          res.status === 'success' && res.result.dockerfile.trim() === draft.trim(),
          'the persisted draft bytes are returned verbatim',
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
];
