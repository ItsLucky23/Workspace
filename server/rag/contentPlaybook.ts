//? Content best-practices PLAYBOOK corpus. Grounds the content AI on DOMAIN craft ("what works" — hooks,
//? retention, thumbnails, ad structure, per-platform rules) at generation time, distinct from the
//? product-knowledge corpus ("what the product can do") and from styles ("how it renders"). Fourth instance
//? of the second-corpus pattern (server/rag/memory.ts, server/content/brandMemory.ts,
//? server/rag/productKnowledge.ts): reuses the ONE embedder + the ONE `retrieve()`, no parallel path.
//?
//? GLOBAL corpus (identical for every tenant) → the reserved zero-ObjectId sentinel workspace + a sentinel
//? commit `content-playbook`. The source is a curated markdown chunked at runtime by `###` heading;
//? idempotent on a content hash (a marker row records it) so boot re-embeds only when the playbook changed.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs';
import path from 'node:path';

import { getPrismaClient, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { embedTexts, embedTag } from './embed';
import { retrieve, type RetrievedChunk } from './index';

//? Bind the corpus hash to the EMBEDDER identity so an embedder switch (dim change) forces a re-embed rather
//? than leaving stale vectors from a different vector space (see server/rag/productKnowledge.ts).
const markerValue = (hash: string): string => `${hash}:${embedTag()}`;

//? Same reserved global scope as the other global corpora; a DISTINCT commit partitions this corpus.
export const PLAYBOOK_WS = '000000000000000000000000';
export const PLAYBOOK_COMMIT = 'content-playbook';
const META_PATH = '__playbook_meta__';
const PLAYBOOK_FILE = path.join(process.cwd(), 'docs', 'content-playbook', 'playbook.md');

interface Chunk { id: string; title: string; text: string }

//? Split the playbook markdown into one chunk per `###` section (heading + body until the next heading). The
//? preceding `##` group name is prepended to each chunk's text so a retrieved chunk carries its category.
function chunkMarkdown(md: string): Chunk[] {
  const lines = md.split(/\r?\n/);
  const chunks: Chunk[] = [];
  let group = '';
  let title = '';
  let body: string[] = [];
  let n = 0;
  const flush = (): void => {
    if (title && body.join('').trim().length > 0) {
      n += 1;
      chunks.push({ id: `playbook-${String(n)}`, title, text: `[${group}] ${title}\n${body.join('\n').trim()}` });
    }
    body = [];
  };
  for (const line of lines) {
    if (line.startsWith('### ')) { flush(); title = line.slice(4).trim(); continue; }
    if (line.startsWith('## ')) { flush(); title = ''; group = line.slice(3).trim(); continue; }
    if (line.startsWith('# ')) continue;
    if (title) body.push(line);
  }
  flush();
  return chunks;
}

//? Read + chunk the playbook (best-effort; null when absent/empty). The hash is over the raw file content.
async function loadPlaybook(): Promise<{ hash: string; chunks: Chunk[] } | null> {
  const [readErr, raw] = await tryCatch(() => new Promise<string>((resolve, reject) => {
    readFile(PLAYBOOK_FILE, 'utf8', (e, d) => { if (e) reject(e); else resolve(d); });
  }));
  if (readErr || typeof raw !== 'string') return null;
  const chunks = chunkMarkdown(raw);
  if (chunks.length === 0) return null;
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return { hash, chunks };
}

export interface PlaybookIndexResult { ok: boolean; entries: number; hash?: string; error?: string }

//? (Re-)index the playbook into the RAG store under the global sentinel. Replaces the prior rows. Best-effort.
export async function indexContentPlaybook(prisma: PrismaClient): Promise<PlaybookIndexResult> {
  const corpus = await loadPlaybook();
  if (!corpus) return { ok: false, entries: 0, error: 'playbook.corpusMissing' };
  const texts = [...corpus.chunks.map((c) => c.text), corpus.hash];
  const [embErr, vectors] = await tryCatch(() => embedTexts(texts, { workspaceId: PLAYBOOK_WS, feature: 'rag-playbook' }));
  if (embErr || !Array.isArray(vectors)) return { ok: false, entries: 0, error: 'playbook.embedFailed' };
  await prisma.ragEntry.deleteMany({ where: { workspaceId: PLAYBOOK_WS, commitHash: PLAYBOOK_COMMIT } });
  const rows = corpus.chunks.map((c, i) => ({ workspaceId: PLAYBOOK_WS, commitHash: PLAYBOOK_COMMIT, filePath: c.id, chunkId: '0', content: c.text, embedding: vectors[i] ?? [] }));
  rows.push({ workspaceId: PLAYBOOK_WS, commitHash: PLAYBOOK_COMMIT, filePath: META_PATH, chunkId: '0', content: markerValue(corpus.hash), embedding: vectors[corpus.chunks.length] ?? [] });
  await prisma.ragEntry.createMany({ data: rows });
  return { ok: true, entries: corpus.chunks.length, hash: corpus.hash };
}

//? Boot hook — index only when the playbook hash changed (marker row). Leader-gated at boot. No-op on match.
export async function ensureContentPlaybook(prisma: PrismaClient = getPrismaClient()): Promise<PlaybookIndexResult> {
  const corpus = await loadPlaybook();
  if (!corpus) return { ok: false, entries: 0, error: 'playbook.corpusMissing' };
  const marker = await prisma.ragEntry.findFirst({ where: { workspaceId: PLAYBOOK_WS, commitHash: PLAYBOOK_COMMIT, filePath: META_PATH }, select: { content: true } });
  if (marker?.content === markerValue(corpus.hash)) return { ok: true, entries: 0, hash: corpus.hash };
  return indexContentPlaybook(prisma);
}

//? Retrieve the top-K best-practice chunks most relevant to `query` (e.g. the brief). Excludes the marker.
export async function retrieveContentPlaybook(prisma: PrismaClient, query: string, k = 3): Promise<RetrievedChunk[]> {
  const hits = await retrieve(prisma, PLAYBOOK_WS, query, k + 1, PLAYBOOK_COMMIT);
  return hits.filter((h) => h.filePath !== META_PATH).slice(0, k);
}
