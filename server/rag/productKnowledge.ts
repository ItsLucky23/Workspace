//? Q2 — product SELF-KNOWLEDGE corpus (AI_LIBRARIES_ACCOUNTS_PROGRAM.md). Indexes the compiled corpus
//? (docs/AI_PRODUCT_KNOWLEDGE.json — capability Q&A + ADR summaries, built by scripts/generateProductKnowledge
//? .mjs) into the SAME unified RAG store (`RagEntry`) so the in-app Workspace-AI can retrieve "what can this
//? product do" at chat-time. Third instance of the second-corpus pattern (server/rag/memory.ts,
//? server/content/brandMemory.ts): reuses the one embedder + the one `retrieve()`, no parallel path.
//?
//? GLOBAL corpus (identical for every tenant), so it lives under a reserved sentinel workspaceId (the zero
//? ObjectId — no real workspace can have it) + a sentinel commit `product-knowledge`. Idempotent on the
//? corpus `hash`: a marker row records the indexed hash so boot re-embeds only when the corpus changed.

import { readFile } from 'node:fs';
import path from 'node:path';

import { getPrismaClient, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { embedTexts } from './embed';
import { retrieve, type RetrievedChunk } from './index';

//? Reserved global scope for the product corpus. The zero ObjectId is a valid 24-hex id no workspace uses.
export const PRODUCT_WS = '000000000000000000000000';
export const PRODUCT_COMMIT = 'product-knowledge';
//? The marker row's filePath — carries the indexed corpus hash + is excluded from retrieval results.
const META_PATH = '__product_meta__';
const CORPUS_FILE = path.join(process.cwd(), 'docs', 'AI_PRODUCT_KNOWLEDGE.json');

interface Chunk { id: string; kind: string; title: string; text: string }
interface Corpus { hash: string; chunks: Chunk[] }

//? Load the compiled corpus shard (best-effort; returns null when absent/malformed).
async function loadCorpus(): Promise<Corpus | null> {
  const [readErr, raw] = await tryCatch(() => new Promise<string>((resolve, reject) => {
    readFile(CORPUS_FILE, 'utf8', (e, d) => { if (e) reject(e); else resolve(d); });
  }));
  if (readErr || typeof raw !== 'string') return null;
  const [parseErr, parsed] = await tryCatch(() => Promise.resolve(JSON.parse(raw) as Corpus));
  if (parseErr || !parsed || !Array.isArray(parsed.chunks)) return null;
  return parsed;
}

export interface ProductIndexResult { ok: boolean; entries: number; hash?: string; error?: string }

//? (Re-)index the product corpus into the RAG store under the global sentinel. Replaces the prior rows
//? (frozen-per-"commit" like code indexing). Best-effort — never throws.
export async function indexProductKnowledge(prisma: PrismaClient): Promise<ProductIndexResult> {
  const corpus = await loadCorpus();
  if (!corpus || corpus.chunks.length === 0) return { ok: false, entries: 0, error: 'product.corpusMissing' };
  const chunks = corpus.chunks.filter((c) => typeof c.text === 'string' && c.text.trim().length > 0);
  //? Embed every chunk + the marker (the hash) in one batch, so the marker also gets a real vector.
  const texts = [...chunks.map((c) => c.text), corpus.hash];
  const [embErr, vectors] = await tryCatch(() => embedTexts(texts));
  if (embErr || !Array.isArray(vectors)) return { ok: false, entries: 0, error: 'product.embedFailed' };
  await prisma.ragEntry.deleteMany({ where: { workspaceId: PRODUCT_WS, commitHash: PRODUCT_COMMIT } });
  const rows = chunks.map((c, i) => ({ workspaceId: PRODUCT_WS, commitHash: PRODUCT_COMMIT, filePath: c.id, chunkId: '0', content: c.text, embedding: vectors[i] ?? [] }));
  rows.push({ workspaceId: PRODUCT_WS, commitHash: PRODUCT_COMMIT, filePath: META_PATH, chunkId: '0', content: corpus.hash, embedding: vectors[chunks.length] ?? [] });
  await prisma.ragEntry.createMany({ data: rows });
  return { ok: true, entries: chunks.length, hash: corpus.hash };
}

//? Boot hook — ensure the product corpus is indexed, re-embedding only when the corpus hash changed. Called
//? leader-gated at boot. No-op when the marker row already matches the current corpus hash.
export async function ensureProductKnowledge(prisma: PrismaClient = getPrismaClient()): Promise<ProductIndexResult> {
  const corpus = await loadCorpus();
  if (!corpus) return { ok: false, entries: 0, error: 'product.corpusMissing' };
  const marker = await prisma.ragEntry.findFirst({ where: { workspaceId: PRODUCT_WS, commitHash: PRODUCT_COMMIT, filePath: META_PATH }, select: { content: true } });
  if (marker?.content === corpus.hash) return { ok: true, entries: 0, hash: corpus.hash };
  return indexProductKnowledge(prisma);
}

//? Retrieve the top-K product-knowledge chunks most relevant to `query` (what the product can do + why).
//? Reuses the single `retrieve()` with the product sentinels; excludes the meta/marker row.
export async function retrieveProductKnowledge(prisma: PrismaClient, query: string, k = 4): Promise<RetrievedChunk[]> {
  const hits = await retrieve(prisma, PRODUCT_WS, query, k + 1, PRODUCT_COMMIT);
  return hits.filter((h) => h.filePath !== META_PATH).slice(0, k);
}
