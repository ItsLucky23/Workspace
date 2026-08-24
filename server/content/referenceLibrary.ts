//? Inspiration/reference LIBRARY — a workspace collects great examples (ads, thumbnails, intros, hooks) and
//? the content AI retrieves the relevant ones at generation time to emulate their STRUCTURE/approach. The
//? `description` ("what makes it work") is the retrieval + grounding signal (a text model can't see the asset,
//? so the human-written why IS the inspiration). Per-workspace RAG under commit `reference` — mirrors
//? server/content/brandMemory.ts: one embedder, one `retrieve()`, indexed incrementally per example.

import type { PrismaClient } from '@prisma/client';

import { embedTextsTagged } from '../rag/embed';
import { retrieve, type RetrievedChunk } from '../rag/index';
import { tryCatch } from '@luckystack/core';

const REFERENCE_COMMIT = 'reference';

//? The retrieval/grounding text for one example (kind + title + why-it-works + tags).
function referenceText(kind: string, title: string, description: string, tags: string[]): string {
  return `[${kind}] ${title}\n${description}${tags.length > 0 ? `\nTags: ${tags.join(', ')}` : ''}`;
}

export interface ReferenceInput { kind: string; title: string; description: string; assetUrl?: string; tags?: string[] }

//? Add an example: persist the row + index its text into the workspace RAG (filePath = the row id, so it can
//? be removed 1:1). Best-effort embed — the example is still saved + shown if embedding fails.
export async function addReference(prisma: PrismaClient, workspaceId: string, input: ReferenceInput): Promise<string> {
  const tags = (input.tags ?? []).filter((t) => typeof t === 'string' && t.trim().length > 0);
  const ref = await prisma.referenceExample.create({
    data: { workspaceId, kind: input.kind, title: input.title, description: input.description, ...(input.assetUrl ? { assetUrl: input.assetUrl } : {}), tags },
  });
  const text = referenceText(input.kind, input.title, input.description, tags);
  const [err, embedded] = await tryCatch(() => embedTextsTagged([text], { workspaceId, feature: 'rag-index' }));
  if (!err && embedded) {
    await prisma.ragEntry.create({ data: { workspaceId, commitHash: REFERENCE_COMMIT, filePath: ref.id, chunkId: '0', content: text, embedding: embedded.vectors[0] ?? [], embedTag: embedded.tag } });
  }
  return ref.id;
}

//? Delete an example: remove the row + its RAG entry (de-index).
export async function deleteReference(prisma: PrismaClient, workspaceId: string, id: string): Promise<void> {
  await prisma.referenceExample.deleteMany({ where: { workspaceId, id } });
  await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: REFERENCE_COMMIT, filePath: id } });
}

//? Retrieve the top-K reference examples most relevant to `query` (the brief). Reuses the single retrieve().
export async function retrieveReferences(prisma: PrismaClient, workspaceId: string, query: string, k = 3): Promise<RetrievedChunk[]> {
  return retrieve(prisma, workspaceId, query, k, REFERENCE_COMMIT);
}
