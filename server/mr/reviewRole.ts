//? AI MR-review role (ADR 0041, C3) — a non-coding AgentRole that reads an MR diff (RAG-grounded) and
//? PROPOSES line-anchored review findings. It NEVER writes: it emits ONE `WorkspaceSuggestion(type:
//? 'mr-review')` carrying the findings; a human accepts it and the Conductor posts the real
//? `ReviewComment(authorKind:'ai')` (B-23 single-writer; BUILTIN_MR_REVIEW bars AI writes). Mirrors the
//? interviewer role: RAG-retrieve → runAiCompletion → parse → persist a proposal. Never approves/merges.

import { tryCatch, getPrismaClient } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';
import { retrieve } from '../rag';
import { retrieveProductKnowledge } from '../rag/productKnowledge';
import { branchDiff } from '../git/repoStore';
import { jsonInput } from '../util/json';
import { parseUnifiedDiff } from './diff';
import { addReviewComment } from './service';

export interface ReviewFinding { filePath: string; line: number; side: string; body: string }

//? Parse the model's review output into findings. One finding per line: `- [path:line] comment`.
//? Tolerant: skips lines that don't match. Exported for tests.
export function parseReviewFindings(text: string): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*[-*]\s*\[([^\]:]+):(\d+)\]\s*(.+)$/.exec(raw.trim());
    if (!m) continue;
    const filePath = (m[1] ?? '').trim();
    const line = Number(m[2]);
    const body = (m[3] ?? '').trim();
    if (filePath.length > 0 && Number.isFinite(line) && body.length > 0) out.push({ filePath, line, side: 'new', body });
  }
  return out;
}

//? Keep only findings that anchor to a REAL changed/context line in the MR diff (the model can
//? hallucinate a line number). Validated against the parsed unified diff's `newNo` per file.
export function validateAgainstDiff(findings: ReviewFinding[], rawDiff: string): ReviewFinding[] {
  const diff = parseUnifiedDiff(rawDiff);
  const valid = new Set<string>();
  for (const f of diff.files) for (const l of f.lines) if (l.newNo !== null) valid.add(`${f.path}:${String(l.newNo)}`);
  return findings.filter((f) => valid.has(`${f.filePath}:${String(f.line)}`)).slice(0, 30);
}

function buildReviewPrompt(diffText: string, ragContext: string, productContext = ''): { system: string; prompt: string } {
  const system = [
    'You are a senior code reviewer reviewing a merge request diff.',
    'Report ONLY concrete, actionable problems: bugs, correctness, security, resource leaks, missing error handling, broken edge cases.',
    'Do NOT comment on style, formatting, or preferences. If the diff is clean, output nothing.',
    'Anchor every finding to a changed line. Output ONE finding per line, EXACTLY in the format:',
    '- [path/to/file.ts:LINE] the concrete problem and the fix',
    'Use the NEW-side line number from the diff. No prose, no headers, no summary — only the finding lines.',
    ragContext.length > 0 ? `\nRepository context (for grounding):\n${ragContext}` : '',
    //? Zelf-bewuste-AI-brug: the product-knowledge corpus (was chat-only) so the review can weigh
    //? PRODUCT intent (what the platform/feature is for), not just code mechanics.
    productContext.length > 0 ? `\nProduct intent context (what this is FOR — weigh findings against it):\n${productContext}` : '',
  ].join('\n');
  return { system, prompt: `Review this merge-request diff:\n\n${diffText.slice(0, 24_000)}` };
}

//? On accept (Conductor, B-23): post each proposed finding as a ReviewComment(authorKind:'ai') — no
//? authorId, so it lands as an AI comment. Reads the `mrId` + `findings` the suggestion's patch carries.
export async function postAiReviewFindings(prisma: PrismaClient, workspaceId: string, patch: unknown): Promise<number> {
  if (patch === null || typeof patch !== 'object') return 0;
  const p = patch as Record<string, unknown>;
  const mrId = typeof p.mrId === 'string' ? p.mrId : '';
  const findings = Array.isArray(p.findings) ? p.findings : [];
  if (mrId.length === 0 || findings.length === 0) return 0;
  let posted = 0;
  for (const raw of findings) {
    if (raw === null || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const filePath = typeof f.filePath === 'string' ? f.filePath : null;
    const line = typeof f.line === 'number' ? f.line : null;
    const body = typeof f.body === 'string' ? f.body : '';
    if (body.length === 0) continue;
    const [, ok] = await tryCatch(() => addReviewComment(prisma, workspaceId, { mergeRequestId: mrId, filePath, line, side: typeof f.side === 'string' ? f.side : 'new', body, authorKind: 'ai' }));
    if (ok) posted += 1;
  }
  return posted;
}

export function registerMrReviewRole(): void {
  registerAgentRole({
    key: 'mr-review',
    label: 'AI MR reviewer',
    description: 'Reads an MR diff (RAG-grounded) and proposes line-anchored review findings for a human to accept.',
    mutates: false,
    run: async (ctx) => {
      const prisma = getPrismaClient();
      const mrSelect = { id: true, projectId: true, sourceBranch: true, targetBranch: true, title: true } as const;
      const mrId = typeof ctx.params.mrId === 'string' ? ctx.params.mrId : '';
      let mr = mrId ? await prisma.mergeRequest.findFirst({ where: { workspaceId: ctx.workspaceId, id: mrId }, select: mrSelect }) : null;
      if (!mr && ctx.ticketKey) {
        const ticket = await prisma.ticket.findFirst({ where: { workspaceId: ctx.workspaceId, key: ctx.ticketKey }, select: { id: true } });
        if (ticket) mr = await prisma.mergeRequest.findFirst({ where: { workspaceId: ctx.workspaceId, ticketId: ticket.id }, orderBy: { createdAt: 'desc' }, select: mrSelect });
      }
      if (!mr) return { kind: 'mr-review', title: 'AI MR review', body: 'No merge request to review.' };

      const [, rawDiff] = await tryCatch(() => branchDiff(ctx.workspaceId, mr.projectId, mr.targetBranch, mr.sourceBranch));
      const diffText = rawDiff ?? '';
      if (diffText.trim().length === 0) return { kind: 'mr-review', title: 'AI MR review', body: 'Empty diff — nothing to review.' };

      const [, chunks] = await tryCatch(() => retrieve(prisma, ctx.workspaceId, mr.title, 6, undefined, mr.projectId));
      const ragContext = (chunks ?? []).map((c) => `// ${c.filePath}\n${c.content}`).join('\n\n').slice(0, 5000);
      const [, pk] = await tryCatch(() => retrieveProductKnowledge(prisma, mr.title, 2));
      const productContext = (pk ?? []).map((c) => c.content).join('\n\n').slice(0, 2000);
      const { system, prompt } = buildReviewPrompt(diffText, ragContext, productContext);

      const [err, res] = await tryCatch(() => runAiCompletion('mr-review', { prompt, system, timeoutMs: 180_000, workspaceId: ctx.workspaceId, label: `MR review · ${mr.title}` }));
      if (err || !res?.ok) return { kind: 'mr-review', title: 'AI MR review', body: `Review failed: ${err?.message ?? res?.error ?? 'unknown'}` };

      const findings = validateAgainstDiff(parseReviewFindings(res.text), diffText);
      if (findings.length === 0) return { kind: 'mr-review', title: 'AI MR review', body: 'No issues found in the diff.' };

      //? Propose — a single WorkspaceSuggestion carrying the findings. On accept the Conductor posts
      //? each as a ReviewComment(authorKind:'ai'). The AI never writes the comment itself (B-23).
      await prisma.workspaceSuggestion.create({
        data: {
          workspaceId: ctx.workspaceId, type: 'mr-review',
          title: `AI review: ${String(findings.length)} finding(s) on ${mr.title}`,
          body: findings.map((f) => `• ${f.filePath}:${String(f.line)} — ${f.body}`).join('\n'),
          ticketIds: [], patch: jsonInput({ mrId: mr.id, findings }), status: 'open',
        },
      });
      return { kind: 'mr-review', title: 'AI MR review', body: `Proposed ${String(findings.length)} review finding(s) for acceptance.` };
    },
  });
}
