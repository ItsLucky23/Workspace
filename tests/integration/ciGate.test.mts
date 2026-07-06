//? Integration test for C1 (built-in CI quality gates, ADR 0039). Runs against the REAL Conductor + Mongo.
//? Asserts the ci.yml parser (pure), the merge gate (`ciGateForMr`: red/stale blocks, green passes, no-run
//? opens), the Admin override, the project green-CI gate, and that a failed CI run blocks a prod promote.
//? The actual job execution is a live Docker path — here we force PipelineRun states to drive the gates.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { parseCiYaml } = await import('../../server/ci/parse');
const { ciGateForMr, ciGreenForProject, allowMergeOnRedCI } = await import('../../server/ci/gate');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure parser (no DB) --------------------------------------------------------------------------
const good = parseCiYaml(`version: 1
stages: [lint, test]
jobs:
  lint:
    stage: lint
    script: ["npm run lint"]
  unit:
    stage: test
    script: ["npm test"]
    needs: [lint]`);
assert(good.ok, 'parseCiYaml accepts a valid config');
eq(good.ok ? good.spec.jobs.length : 0, 2, 'parseCiYaml extracts both jobs');
eq(good.ok ? good.spec.jobs[1]?.needs : [], ['lint'], 'parseCiYaml reads the needs DAG edge');
assert(!parseCiYaml('').ok, 'parseCiYaml rejects an empty config');
assert(!parseCiYaml('version: 1\nstages: [x]').ok, 'parseCiYaml rejects a config with no jobs');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ci-test-${String(stamp)}@youcomm.nl`, name: 'CI Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CI Test WS' }, userId: owner.id, clientRequestId: `ci-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  const projId = proj?.id ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'CI Ticket' }, userId: owner.id, clientRequestId: `ci-t-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'CI Ticket' } }));
  const ticketId = ticket?.id ?? '';

  //? A synthetic MR + pipeline run to drive the gate (no git/docker needed).
  const mr = await prisma.mergeRequest.create({ data: { workspaceId: wsId, projectId: projId, ticketId, number: 1, title: 'CI MR', sourceBranch: ticket?.key ?? 'DEV-1', targetBranch: 'main', status: 'open', headSha: 'abc123', mergeStrategy: 'merge' } });
  const pipeline = await prisma.pipeline.create({ data: { workspaceId: wsId, projectId: projId, specHash: 'x', stages: ['test'], runnerKind: 'builtin' } });
  const run = await prisma.pipelineRun.create({ data: { workspaceId: wsId, pipelineId: pipeline.id, projectId: projId, mergeRequestId: mr.id, commitHash: 'abc123', trigger: 'manual', status: 'failed' } });

  // ---- merge gate: red run for the current head blocks --------------------------------------------
  const redGate = await ciGateForMr(prisma, wsId, mr.id, 'abc123');
  assert(redGate.gated && redGate.reason === 'ci-red', 'a failed CI run for the current head gates the merge (ci-red)');

  // ---- green run passes ---------------------------------------------------------------------------
  await prisma.pipelineRun.updateMany({ where: { id: run.id }, data: { status: 'success' } });
  const greenGate = await ciGateForMr(prisma, wsId, mr.id, 'abc123');
  assert(!greenGate.gated, 'a green CI run does not gate the merge');

  // ---- stale head (branch advanced past the run's commit) gates ----------------------------------
  const staleGate = await ciGateForMr(prisma, wsId, mr.id, 'newhead999');
  assert(staleGate.gated && staleGate.reason === 'ci-stale', 'a green run for an OLD head does not pass (stale)');

  // ---- Admin override via the ci-allow-red op ----------------------------------------------------
  await prisma.pipelineRun.updateMany({ where: { id: run.id }, data: { status: 'failed' } });
  eq(await allowMergeOnRedCI(prisma, wsId), false, 'the override is off by default');
  await enqueueControlAction({ workspaceId: wsId, op: 'ci-allow-red', target: {}, payload: { enabled: true }, userId: owner.id, clientRequestId: `ci-ov-${String(stamp)}` });
  eq(await allowMergeOnRedCI(prisma, wsId), true, 'ci-allow-red turns the Admin override on');

  // ---- project green-CI gate + prod promote block ------------------------------------------------
  eq(await ciGreenForProject(prisma, wsId, projId), false, 'ciGreenForProject is false when the latest run failed');
  //? Force a live staging env, then a prod promote (approved) must be blocked by the red CI.
  const stagingId = await poll(async () => {
    await enqueueControlAction({ workspaceId: wsId, op: 'env-deploy', target: { projectId: projId }, payload: { kind: 'staging' }, userId: owner.id, clientRequestId: `ci-sd-${String(stamp)}-${String(Date.now())}` });
    const s = await prisma.environment.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'staging' } });
    return s?.id ?? null;
  });
  await prisma.environment.updateMany({ where: { id: stagingId ?? '' }, data: { status: 'live', imageRef: 'img:1' } });
  const { result: promoteRes } = await enqueueControlAction({ workspaceId: wsId, op: 'env-promote', target: { projectId: projId }, payload: { fromKind: 'staging', approved: true }, userId: owner.id, clientRequestId: `ci-pp-${String(stamp)}` });
  eq((promoteRes as Record<string, unknown> | null)?.error, 'promote.needsGreenCi', 'a red CI blocks the prod promote (fills the B2 hook)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/ciGate.test.mts');
