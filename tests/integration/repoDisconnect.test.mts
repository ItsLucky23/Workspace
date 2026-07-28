//? Repository disconnect business logic: fail closed on active/unknown runtime state,
//? remove only the selected project's baseline, then clear its URL through one exact write.

import { assert, cleanupWorkspace, db, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { disconnectProjectRepo } = await import('../../server/git/repoDisconnect');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(50);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `repo-disconnect-${String(stamp)}@example.test`, name: 'Repo Disconnect' } });
let workspaceId = '';
try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'Repo Disconnect' }, userId: owner.id, clientRequestId: `repo-disconnect-ws-${String(stamp)}` });
  const workspace = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = workspace?.id ?? '';
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId } }));
  assert(project !== null, 'the fixture project exists');
  const projectId = project?.id ?? '';
  await prisma.project.updateMany({ where: { id: projectId, workspaceId }, data: { gitUrl: 'https://example.test/repo.git' } });

  let unlinkCalls = 0;
  const active = await disconnectProjectRepo(prisma, workspaceId, projectId, {
    hasContainers: async () => true,
    unlink: () => { unlinkCalls += 1; return { linked: false }; },
    linked: () => true,
  });
  eq(active.error, 'repo.inUse', 'an active project container blocks repository disconnect');
  eq(unlinkCalls, 0, 'the active-runtime refusal touches no filesystem state');

  const unavailable = await disconnectProjectRepo(prisma, workspaceId, projectId, {
    hasContainers: async () => null,
    unlink: () => { unlinkCalls += 1; return { linked: false }; },
    linked: () => true,
  });
  eq(unavailable.error, 'repo.runtimeUnavailable', 'unknown Docker state fails closed');
  eq(unlinkCalls, 0, 'runtime uncertainty touches no filesystem state');

  const disconnected = await disconnectProjectRepo(prisma, workspaceId, projectId, {
    hasContainers: async (seenWorkspaceId, seenProjectId) => seenWorkspaceId === workspaceId && seenProjectId === projectId ? false : true,
    unlink: (seenWorkspaceId, seenProjectId) => {
      assert(seenWorkspaceId === workspaceId && seenProjectId === projectId, 'unlink receives the exact tenant/project identity');
      unlinkCalls += 1;
      return { linked: false };
    },
    linked: () => true,
  });
  eq(disconnected, { linked: false }, 'a proven idle project disconnects cleanly');
  eq(unlinkCalls, 1, 'the exact project baseline is removed once');
  eq((await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { gitUrl: true } }))?.gitUrl, null, 'the Conductor helper clears the selected project URL');
} catch (error) {
  assert(false, `unexpected repository disconnect error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/repoDisconnect.test.mts');
