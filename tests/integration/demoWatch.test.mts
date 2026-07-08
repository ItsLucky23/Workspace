//? D3 — demo-host auto-redeploy. Pure `shouldRedeployDemo` covers the decision matrix; the sweep
//? `runDemoWatch` is exercised against the REAL Mongo with an INJECTED head-resolver + deploy (no git, no
//? container) so we assert the wiring: a demo env whose main moved is redeployed, an unchanged one isn't, and
//? a pinned env is never touched. Creates + cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { shouldRedeployDemo, runDemoWatch } = await import('../../server/deploy/demoWatch');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure decision matrix -------------------------------------------------------------------------
assert(shouldRedeployDemo({ autoRedeploy: true, pinnedCommit: null, head: 'b2', deployedCommit: 'a1' }) === true, 'auto + new head → redeploy');
assert(shouldRedeployDemo({ autoRedeploy: true, pinnedCommit: null, head: 'a1', deployedCommit: 'a1' }) === false, 'auto + same head → no redeploy');
assert(shouldRedeployDemo({ autoRedeploy: false, pinnedCommit: null, head: 'b2', deployedCommit: 'a1' }) === false, 'auto off → no redeploy');
assert(shouldRedeployDemo({ autoRedeploy: true, pinnedCommit: 'c3', head: 'b2', deployedCommit: 'c3' }) === false, 'pinned → no redeploy');
assert(shouldRedeployDemo({ autoRedeploy: true, pinnedCommit: null, head: '', deployedCommit: 'a1' }) === false, 'unknown head → no redeploy');
assert(shouldRedeployDemo({ autoRedeploy: true, pinnedCommit: null, head: 'b2', deployedCommit: null }) === true, 'never-deployed + head → redeploy');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `dw-${String(stamp)}@youcomm.nl`, name: 'DW' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'DW WS' }, userId: owner.id, clientRequestId: `dw-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));

  //? A live demo env following main, currently on 'old-sha'; a pinned demo frozen at 'pin-sha'.
  const demo = await prisma.environment.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', kind: 'demo', route: `demo.${wsId}.localhost`, status: 'live', autoRedeploy: true, deployedCommit: 'old-sha' } });
  const pinned = await prisma.environment.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', kind: 'demo', route: `demo-pin.${wsId}.localhost`, status: 'live', autoRedeploy: false, pinnedCommit: 'pin-sha', deployedCommit: 'pin-sha' } });

  //? main moved → the following env redeploys, the pinned one does not.
  const redeployedIds: string[] = [];
  const res1 = await runDemoWatch({ resolveHead: () => Promise.resolve('new-sha'), redeploy: (_p, _ws, envId) => { redeployedIds.push(envId); return Promise.resolve({ ok: true }); } });
  assert(res1.redeployed.includes(demo.id), 'the following demo env is redeployed when main moves');
  assert(!res1.redeployed.includes(pinned.id), 'the pinned demo env is NOT redeployed');
  assert(!redeployedIds.includes(pinned.id), 'the pinned env deploy was never called');

  //? main unchanged → nothing redeploys.
  const res2 = await runDemoWatch({ resolveHead: () => Promise.resolve('old-sha'), redeploy: (_p, _ws, envId) => { redeployedIds.push(envId); return Promise.resolve({ ok: true }); } });
  eq(res2.redeployed.length, 0, 'no redeploy when main is unchanged');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/demoWatch.test.mts');
