//? Integration test for GAP_SCAN D3/D4 against real Mongo: deploy history + rollback target selection,
//? and the durable audit archive that OUTLIVES the workspace whose deletion it records.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { recordDeploy, listDeployHistory, previousLiveCommit } = await import('../../server/deploy/deployHistory');
const { recordAudit, listAuditArchive } = await import('../../server/control/audit');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `dep-${String(stamp)}@youcomm.nl`, name: 'DEP' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'DEP WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId }, select: { id: true } });
  const projectId = project?.id ?? wsId;

  const env = await prisma.environment.create({ data: { workspaceId: wsId, projectId, kind: 'prod', route: `prod-${String(stamp)}.test`, status: 'error', deployedCommit: 'ccc', lastError: 'env.notReady' } });

  /* ---------------------------------------------- D3: history is append-only and ordered */
  await recordDeploy(prisma, { workspaceId: wsId, envId: env.id, projectId, kind: 'prod', branch: 'main', commit: 'aaa', imageRef: null, status: 'live' });
  await recordDeploy(prisma, { workspaceId: wsId, envId: env.id, projectId, kind: 'prod', branch: 'main', commit: 'bbb', imageRef: null, status: 'live' });
  await recordDeploy(prisma, { workspaceId: wsId, envId: env.id, projectId, kind: 'prod', branch: 'main', commit: 'ccc', imageRef: null, status: 'error', error: 'env.notReady' });

  const history = await listDeployHistory(prisma, wsId, env.id);
  eq(history.length, 3, 'every deploy ATTEMPT is recorded, successful or not');
  eq(history[0]?.commit, 'ccc', 'newest first');
  eq(history[0]?.status, 'error', 'a failed deploy is recorded as failed, not hidden');

  //? The whole point: after a bad deploy the previous GOOD commit is still known.
  eq(previousLiveCommit(history, 'ccc'), 'bbb', 'the rollback target is the last commit that was actually live');
  eq(previousLiveCommit(history, 'bbb'), 'aaa', 'rolling back twice walks further back');

  //? History is scoped to its environment — another env's deploys never become a rollback target.
  const other = await prisma.environment.create({ data: { workspaceId: wsId, projectId, kind: 'staging', route: `stg-${String(stamp)}.test`, status: 'stopped' } });
  await recordDeploy(prisma, { workspaceId: wsId, envId: other.id, projectId, kind: 'staging', branch: 'main', commit: 'zzz', imageRef: null, status: 'live' });
  eq((await listDeployHistory(prisma, wsId, env.id)).length, 3, "another environment's deploys stay out of this history");

  /* ---------------------------------------------- D4: the audit archive outlives the workspace */
  await recordAudit(prisma, wsId, owner.id, 'change-role', 'member-x', { from: 'member', to: 'admin' });
  eq((await prisma.auditLog.count({ where: { workspaceId: wsId } })), 1, 'the tenant-scoped log is written');
  const mirrored = await listAuditArchive(prisma, { workspaceId: wsId });
  eq(mirrored.length, 1, 'and mirrored into the durable archive');
  eq(mirrored[0]?.workspaceName, 'DEP WS', 'the archive resolves the workspace NAME at write time (it will not exist later)');

  //? The regression this closes: deleting the workspace wipes AuditLog — including the record OF the delete.
  await enqueueControlAction({ workspaceId: wsId, op: 'delete-workspace', target: {}, payload: {}, userId: owner.id, clientRequestId: `dep-del-${String(stamp)}` });
  eq(await prisma.workspace.count({ where: { id: wsId } }), 0, 'the workspace is gone');
  eq(await prisma.auditLog.count({ where: { workspaceId: wsId } }), 0, 'and its tenant-scoped audit log went with it (as before)');

  const archived = await listAuditArchive(prisma, { workspaceId: wsId });
  assert(archived.length >= 2, 'but the archive survived — including the delete itself');
  assert(archived.some((a) => a.action === 'delete-workspace'), 'the deletion is recorded where the deletion cannot reach');
  assert(archived.some((a) => a.action === 'change-role'), 'and so is the governance history that preceded it');
  eq(archived.find((a) => a.action === 'delete-workspace')?.workspaceName, 'DEP WS', 'the archived row still names the workspace that no longer exists');

  //? Deploy history is tenant data and DOES go with the workspace — only governance is durable by design.
  eq(await prisma.deployHistory.count({ where: { workspaceId: wsId } }), 0, 'deploy history is tenant data and is cascaded');

  await prisma.auditArchive.deleteMany({ where: { workspaceId: wsId } });
  workspaceId = null;
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('deployAudit');
