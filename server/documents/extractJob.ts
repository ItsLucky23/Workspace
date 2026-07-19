//? F35 — durable document extraction.
//?
//? Attaching a file to a document kicks off a container parse (pdf/docx → text). That parse ran
//? fire-and-forget: if the process restarted mid-parse — a deploy, a crash, an OOM — the asset stayed
//? `extractStatus: 'pending'` forever. Nothing retried it, nothing reported it, and the document silently
//? lost the source it was supposed to be grounded in.
//?
//? So the intent gets a row before the work starts, the work claims it, and a sweep re-drives anything left
//? behind. Bounded attempts: a genuinely unparseable file must end as `failed`, not retry forever.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

export const MAX_EXTRACT_ATTEMPTS = 3;
//? A job still 'running' after this long lost its process; a sweep may reclaim it.
export const EXTRACT_STALE_MS = 10 * 60 * 1000;

export interface ExtractJobInput { workspaceId: string; documentId: string; url: string; userId: string }

//? Record the intent. Idempotent per (document, url): re-attaching the same file must not queue a second
//? parse of the same bytes.
export async function enqueueExtractJob(prisma: PrismaClient, input: ExtractJobInput): Promise<string | null> {
  const existing = await prisma.documentExtractJob.findFirst({
    where: { workspaceId: input.workspaceId, documentId: input.documentId, url: input.url, status: { in: ['pending', 'running'] } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const [, created] = await tryCatch(() => prisma.documentExtractJob.create({
    data: { workspaceId: input.workspaceId, documentId: input.documentId, url: input.url, userId: input.userId, status: 'pending' },
  }));
  return created?.id ?? null;
}

//? Claim a job for this process. `updateMany` on the expected status is the claim: two instances racing
//? produce exactly one winner (count === 1), which is what keeps a parse from running twice.
export async function claimExtractJob(prisma: PrismaClient, jobId: string, now = new Date()): Promise<boolean> {
  const claim = await prisma.documentExtractJob.updateMany({
    where: { id: jobId, status: { in: ['pending', 'running'] } },
    data: { status: 'running', startedAt: now, attempts: { increment: 1 } },
  });
  return claim.count === 1;
}

export async function completeExtractJob(prisma: PrismaClient, jobId: string, outcome: { ok: boolean; error?: string }): Promise<void> {
  await tryCatch(() => prisma.documentExtractJob.updateMany({
    where: { id: jobId },
    data: { status: outcome.ok ? 'done' : 'failed', ...(outcome.error ? { lastError: outcome.error.slice(0, 300) } : {}) },
  }));
}

export interface StaleExtractJob { id: string; workspaceId: string; documentId: string; url: string; userId: string; attempts: number }

//? What a sweep should re-drive: anything still pending, or 'running' past the stale window (its process
//? is gone), that has attempts left. A job at the attempt ceiling is marked failed instead — an honest
//? dead end beats an infinite loop over a corrupt file.
export async function reclaimStaleExtractJobs(prisma: PrismaClient, now = Date.now()): Promise<StaleExtractJob[]> {
  const cutoff = new Date(now - EXTRACT_STALE_MS);
  //? luckystack-allow tenant-scope: a host-wide recovery sweep; each job is re-driven inside its own
  //? workspace scope by the caller.
  const candidates = await prisma.documentExtractJob.findMany({
    where: {
      OR: [
        { status: 'pending', createdAt: { lt: cutoff } },
        { status: 'running', startedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, workspaceId: true, documentId: true, url: true, userId: true, attempts: true },
    take: 25,
  });

  const revivable: StaleExtractJob[] = [];
  for (const job of candidates) {
    if (job.attempts >= MAX_EXTRACT_ATTEMPTS) {
      await tryCatch(() => prisma.documentExtractJob.updateMany({ where: { id: job.id }, data: { status: 'failed', lastError: 'extract.attemptsExhausted' } }));
      continue;
    }
    revivable.push(job);
  }
  return revivable;
}
