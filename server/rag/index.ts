//? RAG codebase intelligence (07 §D). Two operations over the append-only `RagEntry` store:
//?  - indexWorkspace: read the linked repo's code at a commit, chunk it, embed each chunk, and
//?    upsert RagEntry rows stamped with that commit (frozen-per-commit; re-index replaces that
//?    commit's rows, leaving other commits intact).
//?  - retrieve: embed a query and return the top-K most similar chunks (app-side cosine scan over
//?    the stored vectors — bounded repos keep this cheap; a Mongo $vectorSearch is a later swap).
//? The stage-runner calls retrieve() to inject the code most relevant to a ticket into the agent's
//? context. Explicit-workspaceId prisma style (matches stageRunner), never throws into the caller.

import type { PrismaClient } from '@prisma/client';

import { listRepoFiles, repoHead } from '../git/repoStore';
import { embedTexts, embedOne, cosine, embedTag } from './embed';

const CHUNK_MAX = 1200;

export interface IndexResult { ok: boolean; files: number; chunks: number; commitHash: string; embedder: string; error?: string }
export interface RetrievedChunk { filePath: string; content: string; score: number }

//? Split a file into line-aligned chunks of ≤CHUNK_MAX chars.
function chunkFile(content: string): string[] {
  const lines = content.split('\n');
  const chunks: string[] = [];
  let buf = '';
  for (const line of lines) {
    if (buf.length + line.length + 1 > CHUNK_MAX && buf.length > 0) { chunks.push(buf); buf = ''; }
    buf += `${line}\n`;
  }
  if (buf.trim().length > 0) chunks.push(buf);
  return chunks;
}

//? Index (or re-index) the workspace's linked repo into the RAG store at a commit (defaults to the
//? bare clone's HEAD, or pass a ticket's frozen commitHash). Replaces that commit's existing rows.
export async function indexWorkspace(
  prisma: PrismaClient, workspaceId: string, opts: { projectId?: string; commitHash?: string } = {},
): Promise<IndexResult> {
  const commitHash = opts.commitHash ?? (await repoHead(workspaceId));
  if (commitHash.length === 0) return { ok: false, files: 0, chunks: 0, commitHash: '', embedder: embedTag(), error: 'rag.noRepo' };

  const files = await listRepoFiles(workspaceId, commitHash);
  if (files.length === 0) return { ok: false, files: 0, chunks: 0, commitHash, embedder: embedTag(), error: 'rag.noFiles' };

  //? Build chunks + the text we embed (path-prefixed so path/identifier queries match).
  const rows: { filePath: string; chunkId: string; content: string; text: string }[] = [];
  for (const f of files) {
    const parts = chunkFile(f.content);
    for (const [i, content] of parts.entries()) rows.push({ filePath: f.path, chunkId: String(i), content, text: `${f.path}\n${content}` });
  }

  const vectors = await embedTexts(rows.map((r) => r.text));

  //? Frozen-per-commit replace: drop this commit's old rows, insert the fresh set.
  await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash } });
  await prisma.ragEntry.createMany({
    data: rows.map((r, i) => ({
      workspaceId,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      commitHash,
      filePath: r.filePath,
      chunkId: r.chunkId,
      content: r.content,
      embedding: vectors[i] ?? [],
    })),
  });

  return { ok: true, files: files.length, chunks: rows.length, commitHash, embedder: embedTag() };
}

//? Retrieve the top-K chunks most relevant to `query`. Scoped to `commitHash` when given, else the
//? most recently indexed commit for the workspace. Empty when nothing is indexed.
export async function retrieve(
  prisma: PrismaClient, workspaceId: string, query: string, k = 6, commitHash?: string,
): Promise<RetrievedChunk[]> {
  if (query.trim().length === 0) return [];
  let ref = commitHash;
  if (!ref) {
    const latest = await prisma.ragEntry.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, select: { commitHash: true } });
    if (!latest) return [];
    ref = latest.commitHash;
  }
  const entries = await prisma.ragEntry.findMany({ where: { workspaceId, commitHash: ref }, select: { filePath: true, content: true, embedding: true } });
  if (entries.length === 0) return [];

  const qvec = await embedOne(query);
  const scored = entries.map((e) => ({
    filePath: e.filePath,
    content: e.content,
    score: cosine(qvec, Array.isArray(e.embedding) ? (e.embedding as number[]) : []),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, k);
}

//? Whether the workspace has any indexed chunks (for the UI status).
export async function ragStatus(prisma: PrismaClient, workspaceId: string): Promise<{ indexed: boolean; chunks: number; commitHash: string | null }> {
  const count = await prisma.ragEntry.count({ where: { workspaceId } });
  const latest = count > 0 ? await prisma.ragEntry.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, select: { commitHash: true } }) : null;
  return { indexed: count > 0, chunks: count, commitHash: latest?.commitHash ?? null };
}
