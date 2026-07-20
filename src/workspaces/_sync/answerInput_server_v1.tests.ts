import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/answerInput/v1` (#17) — a human answers the ticket's
//? open AI question(s). The route dispatches through `dispatchControlSync` → the Conductor,
//? which records the answer as a WorkspaceNote and either advances the `needsInput` banner
//? to the next open question (still parked) or, once every question is answered, resumes the
//? parked agent turn.
//?  [1] happy path — the ticket is seeded with TWO open questions and only one `answer` is
//?      sent, so the Conductor advances the banner to the SECOND question WITHOUT resuming
//?      the agent (`reprovisionTicket`, PTY/container-dependent — never reached by this
//?      case); asserted via the REAL Prisma post-condition (ticket.needsInput advanced +
//?      a WorkspaceNote recorded), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected
//?      with `auth.forbidden`, and the ticket's open question is left untouched.

interface AnswerInputInput { ticketKey: string; answer: string; advisoryIndex?: number; clientRequestId: string }
interface AnswerInputOk { status: 'success'; tickets: { id: string; needsInput?: string }[] }
interface AnswerInputErr { status: 'error'; errorCode: string }
type AnswerInputResponse = AnswerInputOk | AnswerInputErr;

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
    name: 'happy path: answering the first of two open questions advances the banner (Prisma post-condition, no resume)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'answerinput_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const key = `DEV-${String(Date.now() % 100_000)}`;
        const q1 = 'What color scheme?';
        const q2 = 'Which font family?';
        await ctx.prisma.ticket.create({
          data: {
            workspaceId, projectId: project.id, key, number: Date.now() % 100_000,
            title: 'Answer input test ticket', stageId: 'unrefined', status: 'needs-input', labels: [],
            needsInput: q1, needsInputQuestions: [{ q: q1, a: null }, { q: q2, a: null }],
          },
        });

        const res = await ctx.callSync<AnswerInputInput, AnswerInputResponse>(
          { ticketKey: key, answer: 'Blue and white', clientRequestId: `ai-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'answerInput returns status "success"');

        const updated = await poll(() => ctx.prisma.ticket.findFirst({ where: { workspaceId, key, needsInput: q2 } }));
        ctx.expect.ok(updated !== null, 'the Conductor advanced needsInput to the second question (post-condition, not just the ack)');
        ctx.expect.eq(updated?.status, 'needs-input', 'the ticket stays parked — the second question is still open');

        const note = await ctx.prisma.workspaceNote.findFirst({ where: { workspaceId, ticketId: updated?.id, authorKind: 'user' } });
        ctx.expect.ok(note !== null, 'the Conductor recorded the answer as a WorkspaceNote');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'answerinput_c2');
      const outsider = await createRealUser(ctx.prisma, 'answerinput_c2_outsider');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const key = `DEV-${String(Date.now() % 100_000)}`;
        const q1 = 'Should not be answered?';
        await ctx.prisma.ticket.create({
          data: {
            workspaceId, projectId: project.id, key, number: Date.now() % 100_000,
            title: 'Answer input outsider test ticket', stageId: 'unrefined', status: 'needs-input', labels: [],
            needsInput: q1, needsInputQuestions: [{ q: q1, a: null }],
          },
        });

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<AnswerInputInput, AnswerInputResponse>(
          { ticketKey: key, answer: 'Should not apply', clientRequestId: `ai-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const unchanged = await ctx.prisma.ticket.findFirst({ where: { workspaceId, key } });
        ctx.expect.eq(unchanged?.needsInput, q1, 'the open question was left untouched by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
