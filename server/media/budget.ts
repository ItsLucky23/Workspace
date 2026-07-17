//? Media €-budget guard (F0.2, ADR 0051). Media APIs are metered real-money (unlike the coding-agent
//? token accounting, invariant #9), so a pre-generation guard blocks a generation that would push the
//? workspace past its cap, and every generation records a €-ledger row (cents). No budget / disabled /
//? capCents<=0 = unlimited. The Conductor is the writer; these helpers run inside `runInTenant`.

import type { PrismaClient } from '@prisma/client';

import { isHostSpendCapReached } from '../spend/record';

export interface MediaBudgetCheck {
  ok: boolean;
  reason?: 'media.budgetExceeded' | 'media.hostCapExceeded';
  unlimited: boolean;
  capCents: number;
  spentCents: number;
  remainingCents: number;
}

//? Would `costCents` push the workspace past its media €-cap? Pure read — the caller records the spend
//? on success. No budget / `!enabled` / `capCents<=0` = unlimited (always ok) — EXCEPT the host-wide
//? ceiling (WS_HOST_SPEND_CAP_EUR), which caps even unlimited workspaces.
export async function checkMediaBudget(prisma: PrismaClient, workspaceId: string, costCents: number): Promise<MediaBudgetCheck> {
  const b = await prisma.mediaBudget.findUnique({ where: { workspaceId } });
  if (await isHostSpendCapReached(prisma)) {
    return { ok: false, reason: 'media.hostCapExceeded', unlimited: false, capCents: b?.capCents ?? 0, spentCents: b?.spentCents ?? 0, remainingCents: 0 };
  }
  if (!b || !b.enabled || b.capCents <= 0) {
    return { ok: true, unlimited: true, capCents: b?.capCents ?? 0, spentCents: b?.spentCents ?? 0, remainingCents: Number.MAX_SAFE_INTEGER };
  }
  const remainingCents = b.capCents - b.spentCents;
  const ok = costCents <= remainingCents;
  return ok
    ? { ok, unlimited: false, capCents: b.capCents, spentCents: b.spentCents, remainingCents }
    : { ok, reason: 'media.budgetExceeded', unlimited: false, capCents: b.capCents, spentCents: b.spentCents, remainingCents };
}

//? Record a media spend (the € ledger) + debit the running budget. Called AFTER a successful (stub or
//? live) generation.
export async function recordMediaSpend(
  prisma: PrismaClient,
  workspaceId: string,
  e: { contentProjectId?: string; mediaJobId?: string; feature: string; providerId: string; costCents: number },
): Promise<void> {
  await prisma.mediaSpend.create({
    data: {
      workspaceId, feature: e.feature, providerId: e.providerId, costCents: e.costCents,
      ...(e.contentProjectId ? { contentProjectId: e.contentProjectId } : {}),
      ...(e.mediaJobId ? { mediaJobId: e.mediaJobId } : {}),
    },
  });
  await prisma.mediaBudget.updateMany({ where: { workspaceId }, data: { spentCents: { increment: e.costCents } } });
}

//? Current media-budget status (for the settings UI + the snapshot). `overAlert` = past the alert %.
export async function getMediaBudgetStatus(prisma: PrismaClient, workspaceId: string): Promise<{ enabled: boolean; capCents: number; spentCents: number; alertPct: number; overAlert: boolean }> {
  const b = await prisma.mediaBudget.findUnique({ where: { workspaceId } });
  if (!b) return { enabled: false, capCents: 0, spentCents: 0, alertPct: 80, overAlert: false };
  const overAlert = b.enabled && b.capCents > 0 && b.spentCents >= (b.capCents * b.alertPct) / 100;
  return { enabled: b.enabled, capCents: b.capCents, spentCents: b.spentCents, alertPct: b.alertPct, overAlert };
}
