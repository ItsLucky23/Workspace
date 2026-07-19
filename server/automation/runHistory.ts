//? F38 — durable automation runs: history, retry, catch-up and a dead letter.
//?
//? Cron firing was write-once-and-forget. Four separate things were missing, and they are all the same
//? missing thing: nothing recorded that a run was SUPPOSED to happen.
//?   • an enqueue failure was a console line and the tick was gone;
//?   • a minute the instance was down was simply skipped (no catch-up);
//?   • a failed action was never retried;
//?   • "did my nightly automation run?" had no answer.
//?
//? A run row is created BEFORE the work, keyed by (workspace, trigger, minute). That key is what makes
//? catch-up safe: re-driving a missed minute cannot double-fire, because the row already exists.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

export const MAX_RUN_ATTEMPTS = 3;
//? A run still 'running' after this long lost its process.
export const RUN_STALE_MS = 10 * 60 * 1000;
//? How far back a catch-up sweep will look. Beyond this a missed cron is history, not work: re-firing a
//? two-day-old "post at 9am" would publish at the wrong moment, which is worse than skipping it.
export const CATCHUP_WINDOW_MS = 60 * 60 * 1000;

export interface RunKey { workspaceId: string; triggerId: string; triggerName: string; minuteAt: Date }

//? Record the intent. Returns null when this minute already has a row — the caller must then NOT fire,
//? which is what makes both the normal tick and a catch-up sweep idempotent.
export async function openRun(prisma: PrismaClient, key: RunKey): Promise<string | null> {
  const [error, created] = await tryCatch(() => prisma.automationRun.create({
    data: { workspaceId: key.workspaceId, triggerId: key.triggerId, triggerName: key.triggerName, minuteAt: key.minuteAt, status: 'pending' },
  }));
  //? A unique-constraint violation is the expected, correct outcome of a duplicate tick.
  if (error || !created) return null;
  return created.id;
}

export async function startRun(prisma: PrismaClient, runId: string): Promise<boolean> {
  const claim = await prisma.automationRun.updateMany({
    where: { id: runId, status: { in: ['pending', 'failed'] } },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  return claim.count === 1;
}

export async function finishRun(prisma: PrismaClient, runId: string, outcome: { ok: boolean; detail?: string; error?: string }): Promise<void> {
  const run = await prisma.automationRun.findUnique({ where: { id: runId }, select: { attempts: true } });
  //? Out of attempts ⇒ DEAD, not 'failed': a dead letter is a thing an operator can list and act on,
  //? whereas an endlessly-retried failure is just noise.
  const status = outcome.ok ? 'done' : ((run?.attempts ?? 0) >= MAX_RUN_ATTEMPTS ? 'dead' : 'failed');
  await tryCatch(() => prisma.automationRun.updateMany({
    where: { id: runId },
    data: {
      status, finishedAt: new Date(),
      ...(outcome.detail ? { detail: outcome.detail.slice(0, 300) } : {}),
      ...(outcome.error ? { lastError: outcome.error.slice(0, 300) } : {}),
    },
  }));
}

export interface RetryableRun { id: string; workspaceId: string; triggerId: string; triggerName: string; minuteAt: Date; attempts: number }

//? What a sweep should re-drive: failed runs with attempts left, plus 'running' rows whose process died.
//? Bounded and recent-first — an old failure matters less than a fresh one.
export async function retryableRuns(prisma: PrismaClient, now = Date.now()): Promise<RetryableRun[]> {
  const staleCutoff = new Date(now - RUN_STALE_MS);
  const windowStart = new Date(now - CATCHUP_WINDOW_MS);
  //? luckystack-allow tenant-scope: a host-wide recovery sweep; the caller re-enters each workspace's scope.
  return prisma.automationRun.findMany({
    where: {
      minuteAt: { gte: windowStart },
      OR: [
        { status: 'failed', attempts: { lt: MAX_RUN_ATTEMPTS } },
        { status: 'running', startedAt: { lt: staleCutoff } },
      ],
    },
    orderBy: { minuteAt: 'desc' },
    select: { id: true, workspaceId: true, triggerId: true, triggerName: true, minuteAt: true, attempts: true },
    take: 25,
  });
}

//? The minutes a trigger SHOULD have fired in the catch-up window but has no run row for. This is what
//? turns "the instance was down at 09:00" from silent data loss into a late run.
export function missedMinutes(cronMatchesAt: (at: Date) => boolean, existing: Set<number>, now: number, windowMs = CATCHUP_WINDOW_MS): Date[] {
  const missed: Date[] = [];
  const nowMinute = Math.floor(now / 60_000) * 60_000;
  for (let at = nowMinute - windowMs; at < nowMinute; at += 60_000) {
    if (existing.has(at)) continue;
    const when = new Date(at);
    if (cronMatchesAt(when)) missed.push(when);
  }
  //? Newest first, and bounded: an instance down for an hour should catch up the recent misses, not
  //? replay sixty jobs in one tick.
  return missed.toReversed().slice(0, 5);
}

export interface RunHistoryEntry { id: string; triggerName: string; status: string; attempts: number; minuteAt: number; detail: string | null; lastError: string | null }

//? The read surface: what ran, when, and how it ended.
export async function listRunHistory(prisma: PrismaClient, workspaceId: string, limit = 50): Promise<RunHistoryEntry[]> {
  const rows = await prisma.automationRun.findMany({ where: { workspaceId }, orderBy: { minuteAt: 'desc' }, take: limit });
  return rows.map((r) => ({ id: r.id, triggerName: r.triggerName, status: r.status, attempts: r.attempts, minuteAt: r.minuteAt.getTime(), detail: r.detail, lastError: r.lastError }));
}
