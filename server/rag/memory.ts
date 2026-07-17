//? Institutional memory (ADR 0045, E2) — index the workspace's Handoff + CarryOver envelopes into the
//? SAME unified RAG store (`RagEntry`) under a sentinel commit `institutional-memory`, so prior learnings
//? (a past session's summary/decisions/gotchas, a ticket's plan + open questions) SURFACE in a later
//? related ticket via `retrieve(..., 'institutional-memory')`. One store, one embedder, one retrieve —
//? un-defers `additions/03_institutional_memory` without a parallel index. Best-effort: never throws.

import type { PrismaClient } from '@prisma/client';

import { embedTexts } from './embed';
import { retrieve, type RetrievedChunk } from './index';

//? A reserved "commit" that scopes the memory rows (distinct from any real code commit).
export const MEMORY_COMMIT = 'institutional-memory';

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

//? Render a Handoff `body` ({ summary, decisions[], gotchas[], next[] }) into a memory text.
export function handoffText(body: unknown): string {
  if (body === null || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  const parts = [
    str(b.summary),
    strArr(b.decisions).length > 0 ? `Decisions: ${strArr(b.decisions).join('; ')}` : '',
    strArr(b.gotchas).length > 0 ? `Gotchas: ${strArr(b.gotchas).join('; ')}` : '',
    strArr(b.next).length > 0 ? `Next: ${strArr(b.next).join('; ')}` : '',
  ];
  return parts.filter((p) => p.trim().length > 0).join('\n').trim();
}

//? Render a CarryOver `envelope` ({ summary, openQuestions[] }) into a memory text.
export function carryText(envelope: unknown): string {
  if (envelope === null || typeof envelope !== 'object') return '';
  const e = envelope as Record<string, unknown>;
  const parts = [str(e.summary), strArr(e.openQuestions).length > 0 ? `Open questions: ${strArr(e.openQuestions).join('; ')}` : ''];
  return parts.filter((p) => p.trim().length > 0).join('\n').trim();
}

export interface MemoryIndexResult { ok: boolean; entries: number; error?: string }

//? (Re-)index the workspace's Handoffs + CarryOvers into the RAG store under `MEMORY_COMMIT`. Replaces the
//? prior memory rows (frozen-per-"commit" like code indexing). Bounded to the most recent 100 of each.
export async function indexInstitutionalMemory(prisma: PrismaClient, workspaceId: string): Promise<MemoryIndexResult> {
  const [handoffs, carries] = await Promise.all([
    prisma.handoff.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, body: true } }),
    prisma.carryOver.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, envelope: true } }),
  ]);
  const rows: { filePath: string; content: string }[] = [];
  for (const h of handoffs) { const t = handoffText(h.body); if (t.length > 0) rows.push({ filePath: `memory/handoff-${h.id}`, content: t }); }
  for (const c of carries) { const t = carryText(c.envelope); if (t.length > 0) rows.push({ filePath: `memory/carryover-${c.id}`, content: t }); }
  if (rows.length === 0) { await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: MEMORY_COMMIT } }); return { ok: true, entries: 0 }; }

  const vectors = await embedTexts(rows.map((r) => r.content), { workspaceId, feature: 'rag-memory' });
  await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: MEMORY_COMMIT } });
  await prisma.ragEntry.createMany({ data: rows.map((r, i) => ({ workspaceId, commitHash: MEMORY_COMMIT, filePath: r.filePath, chunkId: '0', content: r.content, embedding: vectors[i] ?? [] })) });
  return { ok: true, entries: rows.length };
}

//? Retrieve the top-K institutional-memory chunks most relevant to `query` (prior learnings). Reuses the
//? single `retrieve()` with the memory sentinel — no parallel retrieval path.
export function retrieveMemory(prisma: PrismaClient, workspaceId: string, query: string, k = 4): Promise<RetrievedChunk[]> {
  return retrieve(prisma, workspaceId, query, k, MEMORY_COMMIT);
}
