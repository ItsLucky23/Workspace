//? Docs-generate (register-flow D, the AI half). Where docs-init SCAN registers a repo's
//? existing docs (phase 1c), this has the AI AUTHOR a concise project-summary doc from the
//? repo's files — the orientation an agent reads first. Runs on the provider layer
//? (`runAiCompletion('docs-generate')`) so which AI writes docs is a per-feature choice.
//? The result is persisted as a `generated` context-doc InfoSource (aiEditable on — the AI
//? made it, so it may refresh it). Direct call from an `_api` route (the turn is slow).

import { runAiCompletion } from './registry';
import { repoManifests } from '../git/repoStore';
import { resolveProjectId } from '../orchestrator/projectResolve';
import type { PrismaClient } from '@prisma/client';

export interface DocsGenResult { ok: boolean; name: string; content: string; error?: string }

const DOC_NAME = 'project-summary';

export async function generateProjectDoc(prisma: PrismaClient, workspaceId: string, projectId?: string): Promise<DocsGenResult> {
  const resolvedId = await resolveProjectId(prisma, workspaceId, projectId);
  if (!resolvedId) return { ok: false, name: '', content: '', error: 'repo.notLinked' };
  const ctx = await repoManifests(workspaceId, resolvedId);
  if (ctx.tree.length === 0) return { ok: false, name: '', content: '', error: 'repo.notLinked' };
  const system = [
    'You are a senior engineer writing a CONCISE project-summary doc for an AI coding agent that will work in this repo — the orientation it reads first.',
    'Base your answer ONLY on the files listed below. Do NOT read the filesystem or run any tools — your working directory is empty; the repo content is provided inline here.',
    'Cover, in markdown: what the project is, its architecture / main parts, the tech stack, and the key conventions inferable from the files. Be FACTUAL — infer only from the provided files, never invent features. Keep it under ~400 words.',
    'Output ONLY the markdown doc — no fences, no preamble.',
    `Repo files: ${ctx.tree.join(', ')}`,
    ...ctx.manifests.map((m) => `--- ${m.path} ---\n${m.content}`),
  ].join('\n');
  const res = await runAiCompletion('docs-generate', { prompt: 'Write the project-summary doc now.', system, timeoutMs: 120_000 });
  if (!res.ok) return { ok: false, name: '', content: '', error: res.error ?? 'ai.turnFailed' };
  const content = res.text.trim();
  if (content.length === 0) return { ok: false, name: '', content: '', error: 'docs.empty' };
  const summary = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0)?.slice(0, 140) ?? '';
  const existing = await prisma.infoSource.findFirst({ where: { workspaceId, mode: 'context-doc', name: DOC_NAME } });
  await (existing
    ? prisma.infoSource.update({ where: { id: existing.id }, data: { content, summary, note: 'generated', source: 'generated' } })
    : prisma.infoSource.create({ data: { workspaceId, mode: 'context-doc', source: 'generated', name: DOC_NAME, content, summary, note: 'generated', enabled: true, usedByStages: [] } }));
  return { ok: true, name: DOC_NAME, content };
}
