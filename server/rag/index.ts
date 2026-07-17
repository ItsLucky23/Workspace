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
import { resolveProjectId } from '../orchestrator/projectResolve';
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
  //? R3-b — index the named project's repo (defaults to the active/first project).
  const projectId = await resolveProjectId(prisma, workspaceId, opts.projectId);
  if (!projectId) return { ok: false, files: 0, chunks: 0, commitHash: '', embedder: embedTag(), error: 'rag.noRepo' };
  const commitHash = opts.commitHash ?? (await repoHead(workspaceId, projectId));
  if (commitHash.length === 0) return { ok: false, files: 0, chunks: 0, commitHash: '', embedder: embedTag(), error: 'rag.noRepo' };

  const files = await listRepoFiles(workspaceId, projectId, commitHash);
  if (files.length === 0) return { ok: false, files: 0, chunks: 0, commitHash, embedder: embedTag(), error: 'rag.noFiles' };

  //? Build chunks + the text we embed (path-prefixed so path/identifier queries match).
  const rows: { filePath: string; chunkId: string; content: string; text: string }[] = [];
  for (const f of files) {
    const parts = chunkFile(f.content);
    for (const [i, content] of parts.entries()) rows.push({ filePath: f.path, chunkId: String(i), content, text: `${f.path}\n${content}` });
  }

  const vectors = await embedTexts(rows.map((r) => r.text), { workspaceId, feature: 'rag-index' });

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
//? Reserved commit names for the NON-code corpora that share a workspace's RagEntry rows (memory + the
//? inspiration library) — plus the `brand:<channelId>` prefix. When retrieve() is called WITHOUT a ref (code
//? grounding), the default "latest commit" pick MUST skip these, else a recently-added reference example or a
//? brand snippet (newer createdAt than the last code index) would hijack a code query. The two GLOBAL corpora
//? (product-knowledge/content-playbook) live under the sentinel workspace, so they never reach a real ws here.
export const RESERVED_CORPUS_COMMITS = ['reference', 'institutional-memory', 'product-knowledge', 'content-playbook', 'workspace-documents'];

export async function retrieve(
  prisma: PrismaClient, workspaceId: string, query: string, k = 6, commitHash?: string, projectId?: string,
): Promise<RetrievedChunk[]> {
  if (query.trim().length === 0) return [];
  let ref = commitHash;
  if (!ref) {
    //? R3-b — pick the latest CODE commit OF THE NAMED PROJECT (each project has its own repo/commits now;
    //? without the projectId filter a 2nd project's newer index would hijack the 1st project's code query).
    //? Exclude the named non-code corpora + the brand:* prefix (workspace-level, project-agnostic).
    const latest = await prisma.ragEntry.findFirst({
      where: { workspaceId, ...(projectId ? { projectId } : {}), NOT: [{ commitHash: { in: RESERVED_CORPUS_COMMITS } }, { commitHash: { startsWith: 'brand:' } }] },
      orderBy: { createdAt: 'desc' }, select: { commitHash: true },
    });
    if (!latest) return [];
    ref = latest.commitHash;
  }
  const entries = await prisma.ragEntry.findMany({ where: { workspaceId, commitHash: ref }, select: { filePath: true, content: true, embedding: true } });
  if (entries.length === 0) return [];

  const qvec = await embedOne(query, { workspaceId, feature: 'rag-query' });
  const scored = entries.map((e) => ({
    filePath: e.filePath,
    content: e.content,
    score: cosine(qvec, Array.isArray(e.embedding) ? (e.embedding as number[]) : []),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, k);
}
