//? AI root-cause / rollback role (ADR 0042, B3) — the AI-driver on the existing forward-revert plumbing.
//? Given a SYMPTOM ("prod X is broken") + the recent merges, it RANKS the likely-culprit merge + explains
//? why → a `WorkspaceSuggestion(type:'rollback')`. It NEVER reverts: on accept the Conductor runs the
//? existing `rollbackMr` (forward `git revert -m 1`, invariant #7) + drafts a tracking ticket (B-23).
//? Mirrors the interviewer/mr-review roles (provider abstraction, feature `root-cause`).

import { tryCatch, getPrismaClient } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';

export interface CulpritPick { mrNumber: number | null; reason: string }

//? Parse the model's diagnosis: `CULPRIT: <mr-number>` + `REASON: <text>`. Tolerant — a missing culprit
//? yields `{ mrNumber: null }`. Exported for tests.
export function parseCulprit(text: string): CulpritPick {
  const culpritLine = /culprit:\s*(?:mr[-\s#]*)?(\d+)/i.exec(text);
  const reasonLine = /reason:\s*([\s\S]+?)(?:\n\n|$)/i.exec(text);
  return {
    mrNumber: culpritLine ? Number(culpritLine[1]) : null,
    reason: (reasonLine?.[1] ?? text).trim().slice(0, 1000),
  };
}

function buildRootCausePrompt(symptom: string, merges: { number: number; title: string; branch: string }[]): { system: string; prompt: string } {
  const system = [
    'You are diagnosing a production regression from a symptom + a list of recent merges (newest first).',
    'Identify the SINGLE most likely culprit merge to revert. Prefer the most recent change touching the broken area.',
    'Output EXACTLY two lines, nothing else:',
    'CULPRIT: <the MR number>',
    'REASON: <one short paragraph: why this merge, and what to verify after the revert>',
  ].join('\n');
  const list = merges.map((m) => `MR-${String(m.number)} · ${m.title} (branch ${m.branch})`).join('\n');
  return { system, prompt: `SYMPTOM: ${symptom}\n\nRECENT MERGES (newest first):\n${list}` };
}

export function registerRootCauseRole(): void {
  registerAgentRole({
    key: 'root-cause',
    label: 'AI root-cause / rollback',
    description: 'Given a symptom + recent merges, ranks the likely-culprit merge and proposes a safe rollback.',
    mutates: false,
    run: async (ctx) => {
      const prisma = getPrismaClient();
      const symptom = typeof ctx.params.symptom === 'string' && ctx.params.symptom.trim().length > 0 ? ctx.params.symptom.trim() : 'a production regression was reported';
      const merges = await prisma.mergeRequest.findMany({ where: { workspaceId: ctx.workspaceId, status: 'merged' }, orderBy: { mergedAt: 'desc' }, take: 10, select: { id: true, number: true, title: true, sourceBranch: true } });
      if (merges.length === 0) return { kind: 'rollback', title: 'AI root-cause', body: 'No merged MRs to analyze.' };

      const { system, prompt } = buildRootCausePrompt(symptom, merges.map((m) => ({ number: m.number, title: m.title, branch: m.sourceBranch })));
      const [err, res] = await tryCatch(() => runAiCompletion('root-cause', { prompt, system, timeoutMs: 180_000, workspaceId: ctx.workspaceId, label: `Root-cause · ${symptom.slice(0, 60)}` }));
      if (err || !res?.ok) return { kind: 'rollback', title: 'AI root-cause', body: `Analysis failed: ${err?.message ?? res?.error ?? 'unknown'}` };

      const pick = parseCulprit(res.text);
      const culprit = pick.mrNumber === null ? null : merges.find((m) => m.number === pick.mrNumber);
      if (!culprit) return { kind: 'rollback', title: 'AI root-cause', body: `Could not pin a culprit merge.\n\n${pick.reason}` };

      //? Propose — a rollback suggestion the human accepts. The Conductor then reverts + drafts a ticket.
      await prisma.workspaceSuggestion.create({
        data: {
          workspaceId: ctx.workspaceId, type: 'rollback',
          title: `Rollback MR-${String(culprit.number)}: ${culprit.title}`,
          body: `Symptom: ${symptom}\n\nLikely culprit: MR-${String(culprit.number)} — ${culprit.title}\n\n${pick.reason}`,
          ticketIds: [], patch: { mrId: culprit.id, symptom, reason: pick.reason }, status: 'open',
        },
      });
      return { kind: 'rollback', title: 'AI root-cause', body: `Proposed a rollback of MR-${String(culprit.number)} for acceptance.` };
    },
  });
}
