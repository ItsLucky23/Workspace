//? Integration test for the onboarding `create-workspace` control-op — the path a
//? brand-new (zero-workspace) user takes instead of the old demo seed. Runs against
//? the REAL Conductor + Mongo (not the HTTP server), so it validates the write logic
//? independently of whichever code the live :80 dev server happens to be running.
//?
//? Asserts create-workspace builds a BLANK-but-functional workspace (owner role +
//? membership + Project + default pipeline incl. `unrefined`), and that a subsequent
//? quick-add lands a ticket on it — i.e. onboarding produces a usable board.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cw-test-${String(stamp)}@youcomm.nl`, name: 'CW Test' } });
let workspaceId: string | null = null;

try {
  // ---- create-workspace (login-only op, no active workspace yet) ----------------
  await enqueueControlAction({
    workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CW Test WS' },
    userId: owner.id, clientRequestId: `cw-${String(stamp)}`,
  });

  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  assert(ws !== null, 'create-workspace creates a Workspace owned by the caller');
  workspaceId = ws?.id ?? null;

  //? createBlankWorkspace fills roles → member → project → stages AFTER the workspace
  //? row, so poll for the LAST board element (the unrefined stage) before asserting the
  //? rest — otherwise we race the still-running skeleton build.
  const unrefined = await poll(() => prisma.pipelineStage.findFirst({ where: { workspaceId: workspaceId ?? '', key: 'unrefined' } }));
  assert(unrefined !== null, "create-workspace seeds the default pipeline incl. an 'unrefined' stage");

  const membership = await prisma.workspaceMember.findFirst({ where: { workspaceId: workspaceId ?? '', userId: owner.id } });
  eq(membership?.roleKey, 'owner', 'the caller is the owner member of the new workspace');

  const roles = await prisma.workspaceRole.findMany({ where: { workspaceId: workspaceId ?? '' } });
  eq(roles.map((r) => r.key).sort(), ['admin', 'member', 'owner'], 'the 3 built-in roles are created');

  const project = await prisma.project.findFirst({ where: { workspaceId: workspaceId ?? '' } });
  assert(project !== null, 'create-workspace creates a Project (quick-add needs one)');

  const stages = await prisma.pipelineStage.findMany({ where: { workspaceId: workspaceId ?? '' } });
  assert(stages.length > 0, 'create-workspace seeds the default pipeline stages');

  // ---- quick-add onto the fresh workspace ---------------------------------------
  await enqueueControlAction({
    workspaceId: workspaceId ?? '', op: 'quick-add', target: {}, payload: { title: 'CW Ticket' },
    userId: owner.id, clientRequestId: `cwt-${String(stamp)}`,
  });

  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', title: 'CW Ticket' } }));
  assert(ticket !== null, 'quick-add on a freshly-created workspace writes a Ticket');
  eq(ticket?.stageId, 'unrefined', 'the quick-add ticket enters at unrefined');
  eq(ticket?.projectId, project?.id, 'the ticket is attached to the workspace project');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/createWorkspace.test.mts');
