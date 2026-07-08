//? D3 — demo-host "main draait op DNS X". A `demo` environment serves the deploy branch (main) at a stable
//? route via the existing deploy engine; the ADDED bit is auto-redeploy: a watcher pulls the latest target-
//? branch commit and redeploys the demo env when main moves. A `pinnedCommit` freezes a demo at a fixed
//? commit (a stable demo link) and opts out of auto-redeploy. Pure decision (`shouldRedeployDemo`) + a
//? leader-gated sweep (`runDemoWatch`) with injectable head-resolution + deploy so it is tested without git
//? or Docker.

import { getPrismaClient, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { branchHead } from '../git/repoStore';
import { deployEnvironment } from './environment';
import { normalizeGitConfig } from '../git/branchStrategy';
import { isLeader } from '../orchestrator/cluster';

//? How often the demo-host watcher checks main for new commits.
const DEMO_WATCH_MS = Number(process.env.WS_DEMO_WATCH_MS ?? '60000');

//? Redeploy a demo env when: auto-redeploy is on, it isn't pinned, the branch head is known (non-empty), and
//? it differs from what's currently deployed. Pure + exported for tests.
export function shouldRedeployDemo(input: { autoRedeploy: boolean; pinnedCommit: string | null; head: string; deployedCommit: string | null }): boolean {
  if (!input.autoRedeploy || (input.pinnedCommit ?? '').length > 0) return false;
  const head = input.head.trim();
  if (head.length === 0) return false;
  return head !== (input.deployedCommit ?? '');
}

export interface DemoWatchDeps {
  //? Resolve the current head commit of `branch` for a workspace (default: the real bare-repo rev-parse).
  resolveHead?: (workspaceId: string, branch: string) => Promise<string>;
  //? Redeploy an env (default: the real deploy engine). Injected in tests to avoid a container.
  redeploy?: (prisma: PrismaClient, workspaceId: string, envId: string) => Promise<{ ok: boolean }>;
}

export interface DemoWatchResult { checked: number; redeployed: string[] }

//? One demo-watch sweep: for every LIVE demo env with auto-redeploy on, compare the target-branch head to
//? the deployed commit and redeploy when it moved. Leader-gated by the caller (it triggers authoritative
//? writes). Cross-tenant by design (the leader watches every workspace's demos) — see the H1 allow below.
export async function runDemoWatch(deps: DemoWatchDeps = {}): Promise<DemoWatchResult> {
  const prisma = getPrismaClient();
  const resolveHead = deps.resolveHead ?? branchHead;
  const redeploy = deps.redeploy ?? ((p, ws, envId) => deployEnvironment(p, ws, envId));
  // luckystack-allow tenant-scope: leader-gated demo-host watcher — sweeps EVERY workspace's demo envs cross-tenant by design (H1).
  const demos = await prisma.environment.findMany({ where: { kind: 'demo', autoRedeploy: true, status: { in: ['live', 'error'] } } });
  const redeployed: string[] = [];
  for (const env of demos) {
    const ws = await prisma.workspace.findUnique({ where: { id: env.workspaceId }, select: { gitConfig: true } });
    const branch = normalizeGitConfig(ws?.gitConfig ?? null).targetBranch;
    const head = await resolveHead(env.workspaceId, branch);
    if (!shouldRedeployDemo({ autoRedeploy: env.autoRedeploy, pinnedCommit: env.pinnedCommit, head, deployedCommit: env.deployedCommit })) continue;
    const res = await redeploy(prisma, env.workspaceId, env.id);
    if (res.ok) redeployed.push(env.id);
  }
  return { checked: demos.length, redeployed };
}

//? Boot hook — the leader-gated demo-host watcher. Every tick (only on the leader) sweeps demo envs and
//? redeploys any whose main moved. Mirrors startCronScheduler / startScheduledPublisher.
export function startDemoWatcher(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (!isLeader()) return;
    void tryCatch(() => runDemoWatch()).then(([error]) => { if (error) console.error('[demo-watch] sweep error:', error.message); });
  }, DEMO_WATCH_MS);
}
