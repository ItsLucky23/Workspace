//? F55 — the retention policy sweep.
//?
//? Chat, comments, ticket events, notifications and AI-run rows grew without bound: a workspace that ran
//? for a year kept every message it ever produced, and a self-hoster had no way to say "keep 90 days".
//?
//? Two deliberate choices shape this:
//?   1. **Default is KEEP FOREVER.** Every window defaults to 0 = disabled. Shipping a default that starts
//?      deleting a user's history on upgrade is the worse failure by a wide margin; retention is opt-in.
//?   2. **The sweep is per workspace and observable.** Each pass records what it deleted, so "where did my
//?      data go" has an answer that is not "the cron, probably".
//?
//? Deletion is bounded per pass so a workspace with a year of backlog degrades into several passes instead
//? of one enormous transaction.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import { withTenant } from '../tenant/tenantGuard';

export const RETENTION_INTERVAL_MS = Math.max(60_000, Number(process.env.WS_RETENTION_INTERVAL_MIN ?? '60') * 60_000);
//? How many rows one class may delete per pass. Keeps a first-run backlog from monopolising the DB.
export const RETENTION_BATCH = 2000;

export interface RetentionWindows {
  chatDays: number;
  commentDays: number;
  eventDays: number;
  notificationDays: number;
  aiRunDays: number;
}

export interface RetentionOutcome { deleted: number; byClass: Record<string, number> }

//? A window is only applied when it is positive — 0/absent means "keep", not "delete immediately".
export function cutoffFor(days: number, now: number): Date | null {
  return days > 0 ? new Date(now - days * 86_400_000) : null;
}

//? Apply one workspace's policy. Pure-ish: every delete is scoped by workspaceId AND a cutoff, so the
//? worst a bug here can do is delete less than intended.
export async function sweepWorkspaceRetention(
  prisma: PrismaClient, workspaceId: string, windows: RetentionWindows, now = Date.now(),
): Promise<RetentionOutcome> {
  const byClass: Record<string, number> = {};
  let deleted = 0;

  const run = async (name: string, days: number, remove: (cutoff: Date) => Promise<number>): Promise<void> => {
    const cutoff = cutoffFor(days, now);
    if (cutoff === null) return;
    const [, count] = await tryCatch(() => remove(cutoff));
    const n = count ?? 0;
    if (n > 0) { byClass[name] = n; deleted += n; }
  };

  await run('chat', windows.chatDays, async (cutoff) => {
    const rows = await prisma.workspaceChatMessage.findMany({ where: { workspaceId, createdAt: { lt: cutoff } }, select: { id: true }, take: RETENTION_BATCH });
    if (rows.length === 0) return 0;
    const res = await prisma.workspaceChatMessage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return res.count;
  });

  await run('comments', windows.commentDays, async (cutoff) => {
    //? Only READ comments age out: an unanswered comment is still work, however old it is.
    const rows = await prisma.socialComment.findMany({ where: { workspaceId, read: true, publishedAt: { lt: cutoff } }, select: { id: true }, take: RETENTION_BATCH });
    if (rows.length === 0) return 0;
    const res = await prisma.socialComment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return res.count;
  });

  await run('events', windows.eventDays, async (cutoff) => {
    const rows = await prisma.ticketEvent.findMany({ where: { workspaceId, createdAt: { lt: cutoff } }, select: { id: true }, take: RETENTION_BATCH });
    if (rows.length === 0) return 0;
    const res = await prisma.ticketEvent.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return res.count;
  });

  await run('notifications', windows.notificationDays, async (cutoff) => {
    //? Same reasoning as comments: an UNREAD notification is a pending obligation, not history.
    const rows = await prisma.notification.findMany({ where: { workspaceId, read: true, createdAt: { lt: cutoff } }, select: { id: true }, take: RETENTION_BATCH });
    if (rows.length === 0) return 0;
    const res = await prisma.notification.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return res.count;
  });

  await run('aiRuns', windows.aiRunDays, async (cutoff) => {
    const rows = await prisma.spendRecord.findMany({ where: { workspaceId, createdAt: { lt: cutoff } }, select: { id: true }, take: RETENTION_BATCH });
    if (rows.length === 0) return 0;
    const res = await prisma.spendRecord.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return res.count;
  });

  return { deleted, byClass };
}

//? The cron entry point: every workspace that HAS a policy with at least one positive window.
export async function runRetentionSweep(prisma: PrismaClient, now = Date.now()): Promise<{ workspaces: number; deleted: number }> {
  //? luckystack-allow tenant-scope: a host-wide sweep that re-enters each workspace's own scope below.
  const policies = await prisma.retentionPolicy.findMany({
    where: { OR: [{ chatDays: { gt: 0 } }, { commentDays: { gt: 0 } }, { eventDays: { gt: 0 } }, { notificationDays: { gt: 0 } }, { aiRunDays: { gt: 0 } }] },
    take: 200,
  });

  let deleted = 0;
  for (const policy of policies) {
    const [, outcome] = await tryCatch(() => withTenant(policy.workspaceId, 'retention.sweep', () => sweepWorkspaceRetention(
      prisma, policy.workspaceId,
      { chatDays: policy.chatDays, commentDays: policy.commentDays, eventDays: policy.eventDays, notificationDays: policy.notificationDays, aiRunDays: policy.aiRunDays },
      now,
    )));
    const count = outcome?.deleted ?? 0;
    deleted += count;
    //? Observability is part of the feature: a retention sweep that nobody can audit is indistinguishable
    //? from data loss.
    await tryCatch(() => prisma.retentionPolicy.updateMany({ where: { id: policy.id }, data: { lastSweptAt: new Date(now), lastDeleted: count } }));
  }
  return { workspaces: policies.length, deleted };
}
