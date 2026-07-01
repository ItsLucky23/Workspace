//? Integration test for the Conductor — the SINGLE authoritative writer of
//? workspace state (B-23, server/orchestrator/conductor.ts). Hits the REAL Mongo +
//? Redis (the same runtime path as boot); creates a throwaway owner + workspace and
//? cleans everything up. Run: `npx tsx tests/integration/conductor.test.mts`.
//?
//? Covers the three Conductor surfaces:
//?  1. bootstrapWorkspace  → Workspace + 3 built-in roles + owner membership.
//?  2. enqueueControlAction → the async serial chain writes (save-env + quick-add);
//?     the write is off-thread, so we POLL the DB until each row lands.
//?  3. the cascade teardown → driven via the `delete-workspace` op (the internal
//?     cascadeDeleteWorkspace is not exported; the op is its real caller) — asserts
//?     the workspace + every tenant-scoped row is gone.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

//? Init the secret-manager + Prisma FIRST (via db()), THEN import the Conductor —
//? the module runs `getPrismaClient()` at load, so the client must exist before it.
const prisma = await db();
const { bootstrapWorkspace, enqueueControlAction } = await import('../../server/orchestrator/conductor');

//? Small poll helper — the Conductor writes on an off-thread serial chain, so a row
//? is not visible synchronously after enqueue. Retry until `fn` yields a truthy
//? value (or `true` for the "row is gone" checks), up to ~3s.
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 3000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `conductor-test-${String(stamp)}@youcomm.nl`, name: 'Conductor Test' } });
let workspaceId: string | null = null;

try {
  // ---- 1. bootstrapWorkspace ---------------------------------------------------
  const boot = await bootstrapWorkspace({ name: 'Conductor Test WS', ownerId: owner.id });
  workspaceId = boot.workspaceId;

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  assert(ws !== null, 'bootstrapWorkspace creates the Workspace');
  eq(ws?.ownerId, owner.id, 'the created Workspace has the caller as owner');

  const roles = await prisma.workspaceRole.findMany({ where: { workspaceId } });
  eq(roles.length, 3, 'bootstrapWorkspace seeds exactly 3 built-in roles');
  eq(roles.map((r) => r.key).sort(), ['admin', 'member', 'owner'], 'the 3 roles are owner/admin/member');
  assert(roles.every((r) => r.builtIn === true), 'all 3 seeded roles are marked builtIn');

  const membership = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: owner.id } });
  assert(membership !== null, 'bootstrapWorkspace creates the owner membership');
  eq(membership?.roleKey, 'owner', "the owner's membership roleKey is 'owner'");

  //? quick-add needs a Project in the workspace (bootstrap does not create one) —
  //? create one directly so the op has a target project to attach the ticket to.
  const project = await prisma.project.create({ data: { workspaceId, name: 'test-project', gitlabPath: 'test/project' } });

  // ---- 2. enqueueControlAction (the serial-chain writes) -----------------------
  await enqueueControlAction({
    workspaceId, op: 'save-env', target: {}, payload: { key: 'K', value: 'V', secret: false },
    userId: owner.id, clientRequestId: `env-${String(stamp)}`,
  });
  await enqueueControlAction({
    workspaceId, op: 'quick-add', target: {}, payload: { title: 'T' },
    userId: owner.id, clientRequestId: `ticket-${String(stamp)}`,
  });

  const envVar = await poll(() => prisma.envVar.findFirst({ where: { workspaceId: workspaceId ?? '', key: 'K' } }));
  assert(envVar !== null, "the 'save-env' op writes the EnvVar via the Conductor chain");
  eq(envVar?.value, 'V', 'the written EnvVar carries the value V');
  eq(envVar?.secret, false, 'the written EnvVar carries secret=false');

  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', title: 'T' } }));
  assert(ticket !== null, "the 'quick-add' op writes the Ticket via the Conductor chain");
  eq(ticket?.projectId, project.id, 'the created ticket is attached to the workspace project');
  eq(ticket?.stageId, 'unrefined', "a quick-add'd ticket defaults to the 'unrefined' stage");

  const signals = await prisma.workspaceSignal.findMany({ where: { workspaceId } });
  assert(signals.length >= 2, 'each enqueued action appends an append-only WorkspaceSignal (audit trail)');

  // ---- 3. cascade teardown (via the delete-workspace op) -----------------------
  await enqueueControlAction({
    workspaceId, op: 'delete-workspace', target: {}, payload: {},
    userId: owner.id, clientRequestId: `del-${String(stamp)}`,
  });

  const targetId = workspaceId;
  const gone = await poll(async () => {
    const still = await prisma.workspace.findUnique({ where: { id: targetId } });
    return still === null ? true : null;
  });
  assert(gone === true, 'the delete-workspace op removes the Workspace');
  eq(await prisma.ticket.findFirst({ where: { workspaceId: targetId } }), null, 'cascade teardown removes the tenant Ticket rows');
  eq(await prisma.envVar.findFirst({ where: { workspaceId: targetId } }), null, 'cascade teardown removes the tenant EnvVar rows');
  eq((await prisma.workspaceRole.findMany({ where: { workspaceId: targetId } })).length, 0, 'cascade teardown removes the WorkspaceRole rows');
  eq(await prisma.workspaceMember.findFirst({ where: { workspaceId: targetId } }), null, 'cascade teardown removes the WorkspaceMember rows');

  workspaceId = null; // already torn down — skip the workspace cleanup below
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  //? Best-effort cleanup — remove the throwaway workspace (if the teardown assert
  //? never ran) + the throwaway owner User, in every case.
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/conductor.test.mts');
