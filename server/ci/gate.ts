//? Built-in CI — the merge/promote GATES (ADR 0039, C1). "CI is only a killer feature if it actually
//? gates merge" (BUILTIN_CI §11). A required run that is red/running/stale blocks; a green run for the
//? CURRENT head passes; NO run = nothing to gate (CI is opt-in — a run must exist to block). The Admin
//? `allowMergeOnRedCI` override unwedges a broken runner. Pure reads — the caller enforces.

import type { PrismaClient } from '@prisma/client';

import { SEVERITY_RANK } from './security';

export interface CiGate { gated: boolean; status: string; reason?: string }

//? The CI gate for an MR: given its CURRENT head, is the latest run green? A stale-head green does NOT
//? pass (mirrors the approval staleness model). No run for this MR ⇒ not gated (nothing has run to be red).
export async function ciGateForMr(prisma: PrismaClient, workspaceId: string, mergeRequestId: string, headSha: string | null): Promise<CiGate> {
  //? Per-unit, for the same reason the promote gate is: an MR touching three services has three runs, and
  //? taking only the newest let whichever unit finished last decide the verdict for all of them.
  const runs = await prisma.pipelineRun.findMany({ where: { workspaceId, mergeRequestId, status: { not: 'canceled' } },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });
  if (runs.length === 0) return { gated: false, status: 'none' };

  const latestPerUnit = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    const unit = run.serviceId ?? 'root';
    if (!latestPerUnit.has(unit)) latestPerUnit.set(unit, run);
  }

  //? The WORST verdict wins, and the reason names it — "one of your services is red" must not be reported
  //? as green just because another one passed. Stale beats running beats red only in reporting order; any
  //? of them gates.
  let verdict: CiGate = { gated: false, status: 'success' };
  for (const run of latestPerUnit.values()) {
    if (headSha && run.commitHash !== headSha) return { gated: true, status: 'stale', reason: 'ci-stale' };
    //? 'canceled' (e.g. docker unavailable) is NOT a red result — it never ran, so it doesn't gate.
    if (run.status === 'canceled') continue;
    if (run.status === 'running') { verdict = { gated: true, status: 'running', reason: 'ci-running' }; continue; }
    if (run.status !== 'success') return { gated: true, status: run.status, reason: 'ci-red' };
  }
  return verdict;
}

//? The project-level "is CI green?" gate for a prod promote (B2's TODO hook). Blocks ONLY when a run
//? actually failed/is running; no run/no pipeline ⇒ green (CI is opt-in).
//?
//? Per-service CI changes what "the project is green" MEANS. This used to take the newest run for the
//? project, full stop — so on a monorepo, a green run for service A would pass the gate while service B's
//? run was red, purely because A happened to finish last. Adding a second service silently weakened the
//? prod gate, which is the worst possible failure mode for a gate.
//?
//? It is now per-unit: EVERY service that has run CI must be green at the expected commit. The units are
//? discovered from the runs themselves rather than from the Service table, so a service that never ran CI
//? does not block (still opt-in) and a service row deleted after its run still counts.
export async function ciGreenForProject(prisma: PrismaClient, workspaceId: string, projectId: string, expectedCommit?: string | null): Promise<boolean> {
  const runs = await prisma.pipelineRun.findMany({ where: { workspaceId, projectId, status: { not: 'canceled' } },
    orderBy: { startedAt: 'desc' },
    select: { status: true, commitHash: true, serviceId: true },
    take: 200,
  });
  if (runs.length === 0) return true;

  //? Newest run per unit — an older run of the same unit is superseded, not a second opinion.
  const latestPerUnit = new Map<string, { status: string; commitHash: string }>();
  for (const run of runs) {
    const unit = run.serviceId ?? 'root';
    if (!latestPerUnit.has(unit)) latestPerUnit.set(unit, { status: run.status, commitHash: run.commitHash });
  }

  for (const unit of latestPerUnit.values()) {
    if (expectedCommit && unit.commitHash !== expectedCommit) return false;
    if (unit.status !== 'success') return false;
  }
  return true;
}

//? Is the workspace's Admin override on? (allow merge/promote while a required run is red — unwedges a
//? broken runner, BUILTIN_CI §11 default (A) = gate + Admin override.)
export async function allowMergeOnRedCI(prisma: PrismaClient, workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { allowMergeOnRedCI: true } });
  return ws?.allowMergeOnRedCI === true;
}

//? Security gate for a prod promote (ADR 0040): does the latest run carry a high/critical finding?
//? Report-only on dev/merge — only prod-promote is blocked. No run / low severity ⇒ not blocked.
//? Same per-unit reasoning as `ciGreenForProject`: a critical finding in ANY unit blocks the promote, so
//? this takes the highest severity across every unit's newest run rather than the newest run overall.
export async function securityBlocksProdPromote(prisma: PrismaClient, workspaceId: string, projectId: string, expectedCommit?: string | null): Promise<boolean> {
  const runs = await prisma.pipelineRun.findMany({ where: { workspaceId, projectId, status: { not: 'canceled' }, ...(expectedCommit ? { commitHash: expectedCommit } : {}) },
    orderBy: { startedAt: 'desc' },
    select: { maxSeverity: true, serviceId: true },
    take: 200,
  });

  const seen = new Set<string>();
  let worst = 0;
  for (const run of runs) {
    const unit = run.serviceId ?? 'root';
    if (seen.has(unit)) continue;
    seen.add(unit);
    worst = Math.max(worst, SEVERITY_RANK[run.maxSeverity ?? 'none'] ?? 0);
  }
  return worst >= (SEVERITY_RANK.high ?? 3);
}

//? R2 — the deterministic TEST-stage gate. A `test`-kind stage AUTO-fires the built-in CI on completion; a RED
//? run BLOCKS the ticket from advancing (was free-text only). A missing ci.yml (`none`) or an un-runnable one
//? (`canceled`, no docker) does NOT block — the gate only bites when the CI can actually judge. Pure.
export function isTestStage(kind: string): boolean { return kind === 'test'; }

export type TestGateVerdict = 'pass' | 'fail' | 'nogate';
export function testStageCiVerdict(status: string): TestGateVerdict {
  if (status === 'passed' || status === 'success') return 'pass';
  if (status === 'failed') return 'fail';
  return 'nogate';
}
