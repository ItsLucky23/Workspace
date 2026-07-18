//? GAP_SCAN G8 — competitor / site monitoring over TIME.
//?
//? The scraper fetched a page, summarised it once, and forgot it. That answers "what does this page say?"
//? but never the question a competitor watch actually exists for: "what CHANGED since last time?" Pricing
//? moved, a feature appeared, a claim was dropped — none of it was detectable.
//?
//? Each run stores a content SNAPSHOT (hash + normalized text); the next run diffs against the previous one
//? and reports only the delta. Pure normalization + diffing here, so what counts as a change is testable
//? without a network or a DB.

import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

//? Whitespace, tracking ids and timestamps churn on every fetch. Without normalizing, EVERY run would
//? report a change and the watch would be pure noise — the thing that makes monitoring useless in practice.
export function normalizeForDiff(text: string): string {
  return text
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '')                               // clock times
    .replaceAll(/\b\d{4}-\d{2}-\d{2}\b/g, '')                                     // ISO dates
    .replaceAll(/[?&](utm_[a-z]+|ref|fbclid|gclid)=[^\s&]*/gi, '')                 // tracking params
    .replaceAll(/\b[0-9a-f]{8,}\b/gi, '')                                          // cache-busting hashes/ids
    .trim();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeForDiff(text)).digest('hex').slice(0, 32);
}

//? Sentence-ish units. Short fragments (nav labels, buttons) are dropped — they churn without meaning.
const splitClaims = (t: string): string[] => normalizeForDiff(t)
  .split(/(?<=[.!?])\s+|\n+/)
  .map((l) => l.trim())
  .filter((l) => l.length > 15);

export interface WatchDiff { changed: boolean; added: string[]; removed: string[]; summary: string }

//? Sentence-level diff: what a human reading a competitor page cares about is which CLAIMS appeared or
//? disappeared, not which characters moved. Bounded so one rewritten page cannot produce a 500-line report.
export function diffPages(previous: string, current: string, maxLines = 12): WatchDiff {
  const before = splitClaims(previous);
  const after = splitClaims(current);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((l) => !beforeSet.has(l)).slice(0, maxLines);
  const removed = before.filter((l) => !afterSet.has(l)).slice(0, maxLines);
  const changed = added.length > 0 || removed.length > 0;

  const summary = changed
    ? [
      added.length > 0 ? `ADDED (${String(added.length)}):\n${added.map((l) => `+ ${l}`).join('\n')}` : '',
      removed.length > 0 ? `REMOVED (${String(removed.length)}):\n${removed.map((l) => `- ${l}`).join('\n')}` : '',
    ].filter((s) => s.length > 0).join('\n\n')
    : 'No meaningful change since the last check.';

  return { changed, added, removed, summary };
}

export interface WatchOutcome { first: boolean; changed: boolean; summary: string; hash: string }

//? Record this fetch and report what changed versus the previous snapshot of the SAME url. The first-ever
//? check is explicitly `first` (not "changed"): a baseline is not news, and reporting it as a change on day
//? one is how monitoring loses trust immediately.
export async function recordWatchSnapshot(
  prisma: PrismaClient, workspaceId: string, url: string, text: string,
): Promise<WatchOutcome> {
  const hash = contentHash(text);
  const [, previous] = await tryCatch(() => prisma.siteSnapshot.findFirst({
    where: { workspaceId, url }, orderBy: { createdAt: 'desc' }, select: { hash: true, content: true },
  }));

  const store = async (): Promise<void> => {
    await tryCatch(() => prisma.siteSnapshot.create({ data: { workspaceId, url, hash, content: text.slice(0, 200_000) } }));
  };

  if (!previous) {
    await store();
    return { first: true, changed: false, summary: `Baseline captured for ${url}.`, hash };
  }
  if (previous.hash === hash) return { first: false, changed: false, summary: `No change on ${url} since the last check.`, hash };

  const diff = diffPages(previous.content, text);
  await store();
  return { first: false, changed: diff.changed, summary: diff.changed ? `Changes on ${url}:\n\n${diff.summary}` : `Only cosmetic changes on ${url}.`, hash };
}

//? Prune a watch's history so a daily cron cannot grow unbounded. Keeps the newest `keep` snapshots.
export async function pruneWatchSnapshots(prisma: PrismaClient, workspaceId: string, url: string, keep = 30): Promise<number> {
  const rows = await prisma.siteSnapshot.findMany({ where: { workspaceId, url }, orderBy: { createdAt: 'desc' }, select: { id: true }, skip: keep });
  if (rows.length === 0) return 0;
  await tryCatch(() => prisma.siteSnapshot.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }));
  return rows.length;
}
