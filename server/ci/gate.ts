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
  const run = await prisma.pipelineRun.findFirst({ where: { workspaceId, mergeRequestId }, orderBy: { startedAt: 'desc' } });
  if (!run) return { gated: false, status: 'none' };
  if (headSha && run.commitHash !== headSha) return { gated: true, status: 'stale', reason: 'ci-stale' };
  if (run.status === 'success') return { gated: false, status: 'success' };
  //? 'canceled' (e.g. docker unavailable) is NOT a red result — it never ran, so it doesn't gate.
  if (run.status === 'canceled') return { gated: false, status: 'canceled' };
  if (run.status === 'running') return { gated: true, status: 'running', reason: 'ci-running' };
  return { gated: true, status: run.status, reason: 'ci-red' };
}

//? The project-level "is the latest CI green?" gate for a prod promote (B2's TODO hook). Blocks ONLY when
//? the latest run for the project actually failed/is running; no run/no pipeline ⇒ green (CI opt-in).
export async function ciGreenForProject(prisma: PrismaClient, workspaceId: string, projectId: string): Promise<boolean> {
  const run = await prisma.pipelineRun.findFirst({ where: { workspaceId, projectId }, orderBy: { startedAt: 'desc' }, select: { status: true } });
  if (!run) return true;
  //? 'canceled' never ran → don't block a promote on a runner that couldn't start.
  return run.status === 'success' || run.status === 'canceled';
}

//? Is the workspace's Admin override on? (allow merge/promote while a required run is red — unwedges a
//? broken runner, BUILTIN_CI §11 default (A) = gate + Admin override.)
export async function allowMergeOnRedCI(prisma: PrismaClient, workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { allowMergeOnRedCI: true } });
  return ws?.allowMergeOnRedCI === true;
}

//? Security gate for a prod promote (ADR 0040): does the latest run carry a high/critical finding?
//? Report-only on dev/merge — only prod-promote is blocked. No run / low severity ⇒ not blocked.
export async function securityBlocksProdPromote(prisma: PrismaClient, workspaceId: string, projectId: string): Promise<boolean> {
  const run = await prisma.pipelineRun.findFirst({ where: { workspaceId, projectId }, orderBy: { startedAt: 'desc' }, select: { maxSeverity: true } });
  const sev = run?.maxSeverity ?? 'none';
  return (SEVERITY_RANK[sev] ?? 0) >= (SEVERITY_RANK.high ?? 3);
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
