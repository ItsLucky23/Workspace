//? GAP_SCAN D3 — deploy history + rollback.
//?
//? An environment row only ever knew its CURRENT state (`deployedCommit`, `status`, `lastDeployedAt`). The
//? moment a bad deploy landed, the previous good commit was gone from the system — so "put prod back the
//? way it was" meant a human digging through git. Every deploy attempt now appends an immutable row, and a
//? rollback is just a redeploy pinned to the last commit that was actually LIVE.
//?
//? This deliberately reuses the existing deploy path (pin → `deployEnvironment`) instead of adding a second
//? way to ship: one code path, one set of readiness/route semantics.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

export interface DeployRecord {
  workspaceId: string;
  envId: string;
  projectId: string;
  kind: string;
  branch: string;
  commit: string;
  imageRef: string | null;
  status: string;          // 'live' | 'error'
  error?: string;
}

export async function recordDeploy(prisma: PrismaClient, input: DeployRecord): Promise<void> {
  await tryCatch(() => prisma.deployHistory.create({
    data: {
      workspaceId: input.workspaceId, envId: input.envId, projectId: input.projectId, kind: input.kind,
      branch: input.branch, commit: input.commit, imageRef: input.imageRef, status: input.status,
      ...(input.error ? { error: input.error } : {}),
    },
  }));
}

export interface DeployHistoryEntry { id: string; commit: string; branch: string; status: string; error: string | null; imageRef: string | null; at: number }

export async function listDeployHistory(prisma: PrismaClient, workspaceId: string, envId: string, limit = 20): Promise<DeployHistoryEntry[]> {
  const rows = await prisma.deployHistory.findMany({ where: { workspaceId, envId }, orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map((r) => ({ id: r.id, commit: r.commit, branch: r.branch, status: r.status, error: r.error, imageRef: r.imageRef, at: r.createdAt.getTime() }));
}

//? Which commit a rollback should target: the newest LIVE deploy that is not the one currently running.
//? Returns null when there is no earlier good deploy — the caller must refuse rather than "roll back" to
//? the same broken commit (the failure mode that makes rollback buttons untrustworthy).
export function previousLiveCommit(history: { commit: string; status: string }[], currentCommit: string | null): string | null {
  const live = history.filter((h) => h.status === 'live' && h.commit.length > 0);
  const earlier = live.find((h) => h.commit !== currentCommit);
  return earlier?.commit ?? null;
}
