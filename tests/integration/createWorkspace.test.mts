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
const ownerB = await prisma.user.create({ data: { email: `cw-test-b-${String(stamp)}@youcomm.nl`, name: 'CW Test B' } });
let workspaceId: string | null = null;
let workspaceBId: string | null = null;

try {
  // ---- create-workspace (login-only op, no active workspace yet) ----------------
  const sharedClientRequestId = `cw-${String(stamp)}`;
  const createRequest = {
    workspaceId: '', op: 'create-workspace' as const, target: {}, payload: { name: 'CW Test WS' },
    userId: owner.id, clientRequestId: sharedClientRequestId,
  };
  const createRequestB = {
    workspaceId: '', op: 'create-workspace' as const, target: {}, payload: { name: 'CW Test WS B' },
    userId: ownerB.id, clientRequestId: sharedClientRequestId,
  };
  await enqueueControlAction(createRequest);
  await enqueueControlAction(createRequestB);
  await enqueueControlAction(createRequest);
  await enqueueControlAction(createRequestB);

  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  const wsB = await poll(() => prisma.workspace.findFirst({ where: { ownerId: ownerB.id } }));
  eq(await prisma.workspace.count({ where: { ownerId: owner.id } }), 1, 'a duplicate create-workspace request creates exactly one workspace for user A');
  eq(await prisma.workspace.count({ where: { ownerId: ownerB.id } }), 1, 'the same request id creates exactly one independent workspace for user B');
  assert(ws !== null && wsB !== null, 'global dedup is authenticated-user scoped instead of replaying another user outcome');
  workspaceId = ws?.id ?? null;
  workspaceBId = wsB?.id ?? null;

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
  const indexedBuiltins = await poll(async () => {
    const count = await prisma.ragEntry.count({ where: { workspaceId: workspaceId ?? '', commitHash: 'design-library' } });
    return count === 6 ? count : null;
  }, 8000);
  eq(indexedBuiltins, 6, 'new-workspace bootstrap runs immediate derived design indexing after its writer turn');

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
  if (workspaceBId) await cleanupWorkspace(prisma, workspaceBId, [ownerB.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: ownerB.id } }).catch(() => undefined);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/createWorkspace.test.mts');
