//? Creative knowledge grounding (FREEDOM_PROGRAM K3). Folds the workspace's ENABLED context-doc InfoSources
//? (house style, product facts, examples the user uploaded in K2 or scanned from the repo) into a creative
//? text generation, so "the AI uses my docs" — deterministic + key-less (no embeddings needed). Bounded per
//? doc + in total so a big library never blows the prompt. Semantic (RAG) retrieval that ranks the most
//? relevant chunks is a follow-up; enabled-docs injection is the always-works baseline. Tenant-scoped by
//? explicit `workspaceId` filtering.

import type { PrismaClient } from '@prisma/client';

const PER_DOC_CHARS = 2000;
const MAX_TOTAL_CHARS = 6000;

export async function buildKnowledgeContext(prisma: PrismaClient, workspaceId: string): Promise<string> {
  const docs = await prisma.infoSource.findMany({
    //? ADR 0310 — archived docs stop grounding content generation too, not just the coding agent.
    where: { workspaceId, mode: 'context-doc', enabled: true, archivedAt: null },
    select: { name: true, content: true },
    orderBy: { name: 'asc' },
  });
  if (docs.length === 0) return '';
  const parts: string[] = [];
  let total = 0;
  for (const d of docs) {
    const body = (d.content ?? '').trim().slice(0, PER_DOC_CHARS);
    if (body.length === 0) continue;
    const block = `# ${d.name}\n${body}`;
    if (total + block.length > MAX_TOTAL_CHARS) break;
    parts.push(block);
    total += block.length;
  }
  return parts.length === 0 ? '' : `Reference knowledge (follow it):\n${parts.join('\n\n')}`;
}
