//? Per-channel brand memory (F5.1, ADR 0071). Indexes a channel's brand/style snippets into the SAME
//? unified RAG store (`RagEntry`) under a per-channel sentinel commit `brand:<channelId>`, so a generation
//? for that channel can retrieve its house voice/style — one store, one embedder, one `retrieve()` (mirrors
//? the institutional-memory pattern, ADR 0045). Best-effort. Tenant-scoped by explicit `workspaceId`.

import type { PrismaClient } from '@prisma/client';
import { embedTextsTagged } from '../rag/embed';
import { retrieve, type RetrievedChunk } from '../rag/index';

//? A reserved per-channel "commit" scoping the brand rows (distinct from any real code commit).
export const brandCommit = (channelId: string): string => `brand:${channelId}`;

export interface BrandIndexResult { ok: boolean; entries: number }

//? (Re-)index a channel's brand snippets under its sentinel. Replaces the prior brand rows.
export async function indexChannelBrand(prisma: PrismaClient, workspaceId: string, channelId: string, snippets: string[]): Promise<BrandIndexResult> {
  const commit = brandCommit(channelId);
  const rows = snippets.map((s, i) => ({ filePath: `brand/${channelId}/${String(i)}`, content: s.trim() })).filter((r) => r.content.length > 0);
  if (rows.length === 0) { await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: commit } }); return { ok: true, entries: 0 }; }
  const { vectors, tag } = await embedTextsTagged(rows.map((r) => r.content), { workspaceId, feature: 'rag-index' });
  await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: commit } });
  await prisma.ragEntry.createMany({ data: rows.map((r, i) => ({ workspaceId, commitHash: commit, filePath: r.filePath, chunkId: '0', content: r.content, embedding: vectors[i] ?? [], embedTag: tag })) });
  return { ok: true, entries: rows.length };
}

//? Retrieve the top-K brand chunks most relevant to `query` for a channel (reuses the single retrieve()).
export async function retrieveChannelBrand(prisma: PrismaClient, workspaceId: string, channelId: string, query: string, k = 4): Promise<RetrievedChunk[]> {
  return retrieve(prisma, workspaceId, query, k, brandCommit(channelId));
}
