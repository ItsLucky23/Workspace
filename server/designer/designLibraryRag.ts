/** @docs owner ItsLucky23 */
//? DESIGN_DOCS_PROGRAM 3.6 — the design-library RAG corpus. Saved themes/styles/animations + captured
//? inspiration index here so `generateTheme` (and future design generators) can build on the workspace's
//? GROWING visual language instead of producing a one-off every time. Mirrors server/content/referenceLibrary.ts:
//? one embedder, one retrieve(), indexed per artifact (filePath = the artifact id, so it de-indexes 1:1).

import type { PrismaClient } from '@prisma/client';

import { embedTexts } from '../rag/embed';
import { retrieve, type RetrievedChunk } from '../rag';
import { tryCatch } from '@luckystack/core';

export const DESIGN_LIBRARY_CORPUS = 'design-library';

//? The retrieval/grounding text for one design artifact (kind + name + description). A vision model can't
//? see the tokens, so the name + human/AI description IS the retrieval signal.
function artifactText(kind: string, name: string, description: string): string {
  return `[${kind}] ${name}\n${description}`.trim();
}

//? (Re)index one design artifact. Best-effort — a failed embed never fails the save.
export async function indexDesignArtifact(prisma: PrismaClient, workspaceId: string, artifactId: string, kind: string, name: string, description: string): Promise<void> {
  const text = artifactText(kind, name, description);
  const [err, vectors] = await tryCatch(() => embedTexts([text], { workspaceId, feature: 'rag-index' }));
  if (err || !Array.isArray(vectors)) return;
  await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: DESIGN_LIBRARY_CORPUS, filePath: artifactId } });
  await prisma.ragEntry.create({ data: { workspaceId, commitHash: DESIGN_LIBRARY_CORPUS, filePath: artifactId, chunkId: '0', content: text, embedding: vectors[0] ?? [] } });
}

//? De-index one artifact (on delete).
export async function removeDesignArtifactIndex(prisma: PrismaClient, workspaceId: string, artifactId: string): Promise<void> {
  await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: DESIGN_LIBRARY_CORPUS, filePath: artifactId } });
}

//? Retrieve the top-K existing looks most relevant to a brief, so a new generation can build on them.
export async function retrieveDesignLibrary(prisma: PrismaClient, workspaceId: string, query: string, k = 4): Promise<RetrievedChunk[]> {
  return retrieve(prisma, workspaceId, query, k, DESIGN_LIBRARY_CORPUS);
}
