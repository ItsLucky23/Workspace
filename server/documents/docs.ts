/** @docs owner ItsLucky23 */
//? DOC (DOCUMENTS_AND_SKILLS) — the Documents module's server core: RAG indexing of document content
//? (DOC4) + the AI draft run (DOC2). Documents index into the SHARED workspace RAG under the reserved
//? corpus commit 'workspace-documents' (filePath `doc/<id>/<chunk>`), so workspace-chat and document
//? runs can ground on them; the code-retrieve latest-commit heuristic excludes reserved corpora.
//? The AI NEVER writes `content` here — it produces a DRAFT the user applies (B-23; the apply op in
//? the Conductor is the single writer).
//? @adr 0271

import type { PrismaClient } from '@prisma/client';
import { tryCatch } from '@luckystack/core';

import { embedTexts } from '../rag/embed';
import { retrieve } from '../rag';
import { retrieveProductKnowledge } from '../rag/productKnowledge';
import { runAiCompletion } from '../ai/registry';
import { estimateMediaCostCents, runMediaGeneration } from '../media/registry';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';

export const DOCUMENTS_CORPUS = 'workspace-documents';

//? Split markdown into ~1200-char chunks on paragraph boundaries (mirrors the other corpora).
export function chunkDocument(content: string, max = 1200): string[] {
  const paras = content.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur.length > 0 && cur.length + p.length + 2 > max) { chunks.push(cur); cur = ''; }
    cur = cur.length > 0 ? `${cur}\n\n${p}` : p;
    while (cur.length > max) { chunks.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim().length > 0) chunks.push(cur);
  return chunks;
}

//? (Re)index ONE document into the shared corpus: replace its `doc/<id>/*` rows. Empty content (or a
//? deleted document) just clears its rows. Best-effort at call sites — indexing must never fail a save.
export async function indexDocument(prisma: PrismaClient, workspaceId: string, documentId: string, title: string, content: string): Promise<number> {
  await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: DOCUMENTS_CORPUS, filePath: { startsWith: `doc/${documentId}/` } } });
  const chunks = chunkDocument(content).map((c, i) => ({ filePath: `doc/${documentId}/${String(i)}`, content: `# ${title}\n${c}` }));
  if (chunks.length === 0) return 0;
  const vectors = await embedTexts(chunks.map((c) => c.content), { workspaceId, feature: 'rag-index' });
  await prisma.ragEntry.createMany({ data: chunks.map((c, i) => ({ workspaceId, commitHash: DOCUMENTS_CORPUS, filePath: c.filePath, chunkId: '0', content: c.content, embedding: vectors[i] ?? [] })) });
  return chunks.length;
}

//? Bound the per-document history: keep the newest 20 revisions, prune the rest.
export async function pruneDocumentRevisions(prisma: PrismaClient, workspaceId: string, documentId: string, keep = 20): Promise<void> {
  const rows = await prisma.documentRevision.findMany({ where: { workspaceId, documentId }, orderBy: { createdAt: 'desc' }, select: { id: true }, skip: keep });
  if (rows.length > 0) await prisma.documentRevision.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

export type DocumentAiMode = 'generate' | 'rewrite' | 'summarize' | 'extend';

const MODE_TASK: Record<DocumentAiMode, string> = {
  generate: 'Write the document from scratch based on the instruction. Output the COMPLETE new markdown document.',
  rewrite: 'Rewrite the current document per the instruction, preserving intent and factual content. Output the COMPLETE new markdown document.',
  summarize: 'Produce a tighter, well-structured version that keeps every essential point. Output the COMPLETE new markdown document.',
  extend: 'Extend the current document per the instruction (add the requested sections where they fit). Output the COMPLETE new markdown document.',
};

//? DOC2 — one AI draft run: grounded on the workspace's OWN documents + product knowledge; skills
//? ('documents' apply-point) inject automatically at the completion choke-point. Returns the draft
//? text or an error code — the CALLER (Conductor) stores it as aiDraft.
export async function runDocumentAi(
  prisma: PrismaClient, workspaceId: string,
  doc: { id: string; title: string; content: string }, mode: DocumentAiMode, instruction: string,
): Promise<{ ok: boolean; text: string; error?: string }> {
  const query = `${doc.title}\n${instruction}`.trim();
  const [, docHits] = await tryCatch(() => retrieve(prisma, workspaceId, query, 4, DOCUMENTS_CORPUS));
  const otherDocs = (docHits ?? []).filter((h) => !h.filePath.startsWith(`doc/${doc.id}/`)).map((h) => h.content).join('\n\n').slice(0, 2500);
  const [, pkChunks] = await tryCatch(() => retrieveProductKnowledge(prisma, query, 2));
  const productDoc = (pkChunks ?? []).map((c) => c.content).join('\n\n').slice(0, 1500);
  const system = [
    'You are the workspace document writer. Output ONLY the full markdown document — no preamble, no code fences around the whole document.',
    'Use clean markdown: a single H1 title, clear section headings, tables where data is tabular (tables also drive the spreadsheet export).',
    otherDocs.length > 0 ? `Related workspace documents (ground on these, do not contradict them):\n${otherDocs}` : '',
    productDoc.length > 0 ? `Product context:\n${productDoc}` : '',
  ].filter((s) => s.length > 0).join('\n\n');
  const prompt = [
    `Task: ${MODE_TASK[mode]}`,
    `Instruction: ${instruction.trim().length > 0 ? instruction.trim() : '(none — use the title and current content)'}`,
    `Document title: ${doc.title}`,
    mode === 'generate' ? '' : `Current document:\n${doc.content}`,
  ].filter((s) => s.length > 0).join('\n\n');
  const res = await runAiCompletion('document-generate', { prompt, system, workspaceId, label: `Document: ${doc.title} (${mode})` });
  if (!res.ok) return { ok: false, text: '', error: res.error ?? 'ai.failed' };
  //? Strip a whole-document code fence if the model wrapped it anyway.
  const text = res.text.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, '$1').trim();
  return { ok: true, text };
}

//? DOC3 — one AI image for a document (reuses the media pipeline: budget guard → generation → spend
//? record; honest stub without a key). The CALLER appends the returned asset to Document.assets.
export async function generateDocumentImage(
  prisma: PrismaClient, workspaceId: string, docTitle: string, prompt: string,
): Promise<{ ok: boolean; blocked?: boolean; url?: string; stub?: boolean; costCents: number }> {
  const budget = await checkMediaBudget(prisma, workspaceId, estimateMediaCostCents('image-gen'));
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0 };
  const res = await runMediaGeneration({ feature: 'image-gen', prompt, workspaceId, label: `Document image: ${docTitle}` });
  if (!res.ok || !res.asset) return { ok: false, costCents: 0 };
  await tryCatch(() => recordMediaSpend(prisma, workspaceId, { feature: 'image-gen', providerId: res.providerId, costCents: res.costCents }));
  const stub = res.asset.metadata.stub === true;
  return { ok: true, url: res.asset.url, stub, costCents: res.costCents };
}
