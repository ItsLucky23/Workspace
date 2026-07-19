//? Integration test for B2 (deploy/CD + downloadable builds, ADR 0038). Runs against the REAL Conductor
//? + Mongo. Asserts the promote ladder gates (source must be live; prod needs approval) and that
//? build-export creates a BuildArtifact row that fails gracefully without a built image (never throws).
//? The actual container launch + docker save are live/Docker paths — here we drive the model + gates,
//? forcing env states directly so the gates are exercised without Docker.

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
//? Enqueue a control op and return the Conductor's op result (deploy/promote/export return an object).
async function op(workspaceId: string, o: string, target: Record<string, unknown>, payload: Record<string, unknown>, id: string): Promise<Record<string, unknown> | null> {
  const { result } = await enqueueControlAction({ workspaceId, op: o, target, payload, userId: 'sys', clientRequestId: id });
  return (result ?? null) as Record<string, unknown> | null;
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cd-test-${String(stamp)}@youcomm.nl`, name: 'CD Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CD Test WS' }, userId: owner.id, clientRequestId: `cd-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  const projId = proj?.id ?? '';

  // ---- ensure a dev env exists, then FORCE it live (bypassing the Docker launch) -----------------
  await op(wsId, 'env-deploy', { projectId: projId }, { kind: 'dev' }, `cd-d-${String(stamp)}`);
  const dev = await poll(() => prisma.environment.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'dev' } }));
  assert(dev !== null, 'a dev environment exists');
  //? F26 — a promotion now carries the SOURCE's tested commit forward. Forcing an env "live" without a
  //? deployedCommit therefore no longer promotes: you cannot ship what you cannot identify. The fixture
  //? sets one, and the refusal itself is asserted below.
  await prisma.environment.updateMany({ where: { id: dev?.id ?? '' }, data: { status: 'live', imageRef: 'workspaces/proj-test:abc', deployedCommit: 'abc123def456' } });

  // ---- F26: a live env with NO recorded commit cannot be promoted ------------------------------
  //? This is the gap that made promotion dangerous: it gated on the source's tested commit and then
  //? deployed the target at branch TIP, shipping code that was never the thing that passed.
  await prisma.environment.updateMany({ where: { id: dev?.id ?? '' }, data: { deployedCommit: null } });
  const blockedNoCommit = await op(wsId, 'env-promote', { projectId: projId }, { fromKind: 'dev' }, `cd-p0-${String(stamp)}`);
  eq(blockedNoCommit?.error, 'promote.sourceHasNoCommit', 'a live source with no recorded commit cannot be promoted');
  await prisma.environment.updateMany({ where: { id: dev?.id ?? '' }, data: { deployedCommit: 'abc123def456' } });

  // ---- promote dev→staging (no approval needed) → creates + deploys staging ----------------------
  await op(wsId, 'env-promote', { projectId: projId }, { fromKind: 'dev' }, `cd-p1-${String(stamp)}`);
  const staging = await poll(() => prisma.environment.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'staging' } }));
  assert(staging !== null, 'promote dev→staging creates the staging environment');

  // ---- promote NON-live source → blocked ---------------------------------------------------------
  const blockedNotLive = await op(wsId, 'env-promote', { projectId: projId }, { fromKind: 'staging' }, `cd-p2-${String(stamp)}`);
  eq(blockedNotLive?.error, 'promote.sourceNotLive', 'promoting a non-live source is blocked');

  // ---- FORCE staging live, then prod promote WITHOUT approval → blocked ---------------------------
  await prisma.environment.updateMany({ where: { id: staging?.id ?? '' }, data: { status: 'live', imageRef: 'workspaces/proj-test:abc', deployedCommit: 'abc123def456' } });
  const blockedNoApproval = await op(wsId, 'env-promote', { projectId: projId }, { fromKind: 'staging' }, `cd-p3-${String(stamp)}`);
  eq(blockedNoApproval?.error, 'promote.prodNeedsApproval', 'promoting to prod without approval is blocked (B-23 confirm gate)');

  // ---- prod promote WITH approval → creates the prod env -----------------------------------------
  await op(wsId, 'env-promote', { projectId: projId }, { fromKind: 'staging', approved: true }, `cd-p4-${String(stamp)}`);
  const prod = await poll(() => prisma.environment.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'prod' } }));
  assert(prod !== null, 'an approved prod promote creates the prod environment');

  // ---- build-export without a built image → a BuildArtifact row in error status (never throws) ----
  const exportRes = await op(wsId, 'build-export', { projectId: projId }, { kind: 'image' }, `cd-e1-${String(stamp)}`);
  assert(exportRes?.status === 'error' || exportRes?.status === 'ready', 'build-export returns a terminal status');
  const artifact = await poll(() => prisma.buildArtifact.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'image' } }));
  assert(artifact !== null, 'build-export creates a BuildArtifact row');
  assert((artifact?.downloadToken ?? '').length >= 32, 'the artifact has an unguessable download token');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/deployCd.test.mts');
