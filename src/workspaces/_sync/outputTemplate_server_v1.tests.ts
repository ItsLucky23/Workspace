import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/outputTemplate/v1` — create/update/delete a reusable output
//? spec (FREEDOM_PROGRAM O5). Covers:
//?  [1] happy path — `save-output-template` dispatched through the Conductor; asserted via the
//?      real Prisma post-condition (an `OutputTemplate` row), not just the ack.
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and no template row is created.

interface OutputTemplateInput {
  op: 'save-output-template' | 'delete-output-template'; clientRequestId: string;
  templateId?: string; name?: string; format?: string; watermarkPosition?: string;
}
interface OutputTemplateOk { status: 'success' }
interface OutputTemplateErr { status: 'error'; errorCode: string }
type OutputTemplateResponse = OutputTemplateOk | OutputTemplateErr;

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
    name: 'happy path: save-output-template creates an OutputTemplate row (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'outputtemplate_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Sync harness template ${String(Date.now())}`;
        const res = await ctx.callSync<OutputTemplateInput, OutputTemplateResponse>(
          { op: 'save-output-template', clientRequestId: `ot-c1-${String(Date.now())}`, name, format: '9:16', watermarkPosition: 'br' },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'outputTemplate returns status "success"');

        const template = await poll(() => ctx.prisma.outputTemplate.findFirst({ where: { workspaceId, name } }));
        ctx.expect.ok(template !== null, 'the Conductor persisted the OutputTemplate (post-condition, not just the ack)');
        ctx.expect.eq(template?.format, '9:16', 'the persisted template carries the format we sent');
        ctx.expect.eq(template?.watermarkPosition, 'br', 'the persisted template carries the watermarkPosition we sent');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'outputtemplate_c2');
      const outsider = await createRealUser(ctx.prisma, 'outputtemplate_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const name = `Should not be created ${String(Date.now())}`;
        const res = await ctx.callSync<OutputTemplateInput, OutputTemplateResponse>(
          { op: 'save-output-template', clientRequestId: `ot-c2-${String(Date.now())}`, name, format: '16:9' },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const template = await ctx.prisma.outputTemplate.findFirst({ where: { workspaceId, name } });
        ctx.expect.ok(template === null, 'no template was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
