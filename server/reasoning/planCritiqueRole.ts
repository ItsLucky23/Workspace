//? Plan-critique gate (ADR 0044, E1) — an adversarial reasoning pass that ATTACKS a ticket's plan (the
//? latest CarryOver envelope: summary + open questions) BEFORE the implement stage runs. It surfaces
//? "what's missing / what breaks / what's the risky assumption" as a `WorkspaceSuggestion(type:'plan-critique')`
//? the human folds in — never a second AI window (all through the suggestion/feed). Non-coding role
//? (provider abstraction, feature `plan-critique`), mirroring mr-review/root-cause. Read-only: it proposes,
//? it does not change the plan.

import { tryCatch, getPrismaClient } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';

//? Pull the plan text out of a CarryOver `envelope` JSON ({ summary, openQuestions[], changedFiles[] }).
//? Exported for tests. Returns '' when there's no usable plan.
export function extractPlan(envelope: unknown): string {
  if (envelope === null || typeof envelope !== 'object') return '';
  const e = envelope as Record<string, unknown>;
  const summary = typeof e.summary === 'string' ? e.summary : '';
  const questions = Array.isArray(e.openQuestions) ? e.openQuestions.filter((q): q is string => typeof q === 'string') : [];
  const parts = [summary, questions.length > 0 ? `Open questions:\n${questions.map((q) => `- ${q}`).join('\n')}` : ''];
  return parts.filter((p) => p.trim().length > 0).join('\n\n').trim();
}

//? Build the adversarial critique prompt. Exported for tests.
export function buildCritiquePrompt(plan: string): { system: string; prompt: string } {
  const system = [
    'You are an adversarial senior engineer reviewing an implementation PLAN before any code is written.',
    'Attack it: what is MISSING, what will BREAK, which assumption is risky, which edge case is unhandled, what is under-specified.',
    'Be concrete and specific. If the plan is genuinely solid, say so in one line.',
    'Output a short bulleted list of the most important gaps — no preamble, no restating the plan.',
  ].join('\n');
  return { system, prompt: `PLAN:\n\n${plan.slice(0, 12_000)}` };
}

export function registerPlanCritiqueRole(): void {
  registerAgentRole({
    key: 'plan-critique',
    label: 'Plan critique',
    description: 'Adversarially attacks a ticket plan before implement and proposes the gaps to fold in.',
    mutates: false,
    run: async (ctx) => {
      const prisma = getPrismaClient();
      if (!ctx.ticketKey) return { kind: 'plan-critique', title: 'Plan critique', body: 'No ticket to critique.' };
      const ticket = await prisma.ticket.findFirst({ where: { workspaceId: ctx.workspaceId, key: ctx.ticketKey }, select: { id: true } });
      if (!ticket) return { kind: 'plan-critique', title: 'Plan critique', body: 'No ticket to critique.' };
      const carry = await prisma.carryOver.findFirst({ where: { workspaceId: ctx.workspaceId, ticketId: ticket.id }, orderBy: { createdAt: 'desc' }, select: { envelope: true } });
      const plan = extractPlan(carry?.envelope);
      if (plan.length === 0) return { kind: 'plan-critique', title: 'Plan critique', body: 'No plan found to critique yet.' };

      const { system, prompt } = buildCritiquePrompt(plan);
      const [err, res] = await tryCatch(() => runAiCompletion('plan-critique', { prompt, system, timeoutMs: 180_000, workspaceId: ctx.workspaceId, label: `Plan critique · ${ctx.ticketKey}` }));
      if (err || !res?.ok || res.text.trim().length === 0) return { kind: 'plan-critique', title: 'Plan critique', body: `Critique failed: ${err?.message ?? res?.error ?? 'unknown'}` };

      //? Propose — an advisory suggestion the human folds into the plan before implement (no auto-apply).
      await prisma.workspaceSuggestion.create({
        data: { workspaceId: ctx.workspaceId, type: 'plan-critique', title: `Plan critique: ${ctx.ticketKey}`, body: res.text.trim().slice(0, 4000), ticketIds: [], patch: { ticketKey: ctx.ticketKey }, status: 'open' },
      });
      return { kind: 'plan-critique', title: 'Plan critique', body: 'Proposed plan-critique findings for review.' };
    },
  });
}
