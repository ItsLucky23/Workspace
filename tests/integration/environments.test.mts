//? Integration test for B1 (persistent environments, ADR 0037). Runs against the REAL Conductor +
//? Mongo. Asserts env-deploy creates ONE Environment row per (project, kind) with a stable derived
//? route, that the deploy fails gracefully (no linked repo / no docker in the test env) onto the row
//? as status:'error' (never throws), that a redeploy reuses the same row (find-or-create), that a
//? second kind is a distinct env, and that env-teardown marks it stopped. The full container launch is
//? a live/Docker path — here we assert the model + control-op + route derivation, which need no Docker.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `env-test-${String(stamp)}@youcomm.nl`, name: 'ENV Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'ENV Test WS' }, userId: owner.id, clientRequestId: `env-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  const projId = proj?.id ?? '';

  // ---- env-deploy dev → an Environment row (deploy fails gracefully w/o a linked repo/docker) ----
  await enqueueControlAction({ workspaceId: wsId, op: 'env-deploy', target: { projectId: projId }, payload: { kind: 'dev' }, userId: owner.id, clientRequestId: `env-d1-${String(stamp)}` });
  const dev = await poll(() => prisma.environment.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'dev' } }));
  assert(dev !== null, 'env-deploy creates an Environment row for the project');
  eq(dev?.kind, 'dev', 'the environment kind is dev');
  assert((dev?.route ?? '').includes('dev') && (dev?.route ?? '').length > 4, 'the environment has a stable derived route host');
  assert(dev?.status === 'error' || dev?.status === 'live', 'the deploy resolves to a terminal status (error without a linked repo/docker, or live)');

  // ---- redeploy reuses the SAME row (find-or-create idempotency) --------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'env-deploy', target: { projectId: projId }, payload: { kind: 'dev' }, userId: owner.id, clientRequestId: `env-d2-${String(stamp)}` });
  await wait(400);
  const devRows = await prisma.environment.findMany({ where: { workspaceId: wsId, projectId: projId, kind: 'dev' } });
  eq(devRows.length, 1, 'a redeploy reuses the same Environment row (one env per project+kind)');

  // ---- a second kind is a distinct environment --------------------------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'env-deploy', target: { projectId: projId }, payload: { kind: 'staging' }, userId: owner.id, clientRequestId: `env-d3-${String(stamp)}` });
  const staging = await poll(() => prisma.environment.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'staging' } }));
  assert(staging !== null && staging.id !== dev?.id, 'staging is a distinct environment from dev');

  // ---- teardown marks it stopped ----------------------------------------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'env-teardown', target: { envId: dev?.id ?? '' }, payload: {}, userId: owner.id, clientRequestId: `env-td-${String(stamp)}` });
  const stopped = await poll(async () => { const e = await prisma.environment.findFirst({ where: { id: dev?.id ?? '' } }); return e?.status === 'stopped' ? e : null; });
  assert(stopped !== null, 'env-teardown marks the environment stopped');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/environments.test.mts');
