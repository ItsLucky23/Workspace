//? Content ideator role (F3.3, ADR 0067) — a SCHEDULABLE content-generation role. A cron trigger
//? (`action:'invoke-agent-role', params:{role:'content-ideator', theme?}`) fires it; because it `mutates`
//? (proposing content is a write path), the automation executor GATES it into an approval suggestion — it
//? never writes content directly (B-23). Call `registerContentIdeatorRole()` once at boot.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';
import { topPerformers } from './publishMetrics';

//? CP4 — the analytics→ideas feedback loop: fold the workspace's recent best-performing posts (by views) into
//? the ideator's prompt so future ideas lean toward what actually worked. Best-effort; empty when nothing has
//? metrics yet. Joins each done PublishJob's ingested metrics to its piece title.
export async function recentWinnersLine(workspaceId: string): Promise<string> {
  const [, rows] = await tryCatch(async () => {
    const prisma = getPrismaClient();
    const jobs = await prisma.publishJob.findMany({ where: { workspaceId, status: 'done', metrics: { not: null } }, select: { platform: true, metrics: true, contentProjectId: true }, take: 50 });
    if (jobs.length === 0) return [] as { platform: string; title: string; metrics: unknown }[];
    const pieces = await prisma.contentProject.findMany({ where: { workspaceId, id: { in: jobs.map((j) => j.contentProjectId) } }, select: { id: true, title: true } });
    const titleById = new Map(pieces.map((p) => [p.id, p.title]));
    return jobs.map((j) => ({ platform: j.platform, title: titleById.get(j.contentProjectId) ?? 'a post', metrics: j.metrics }));
  });
  const winners = topPerformers(rows ?? []);
  if (winners.length === 0) return '';
  return `\nRecent WINNERS (lean the idea toward what worked): ${winners.map((w) => `"${w.title}" (${w.platform}, ${String(w.views)} views)`).join('; ')}.`;
}

export function registerContentIdeatorRole(): void {
  registerAgentRole({
    key: 'content-ideator',
    label: 'Content ideator',
    description: 'Proposes a fresh content idea for a channel on a schedule (gated to a suggestion — B-23).',
    mutates: true,
    run: async (ctx) => {
      const theme = typeof ctx.params.theme === 'string' && ctx.params.theme ? ctx.params.theme : 'your channel';
      //? CP4 — ground the idea in the channel's actual top performers when there are any.
      const winners = await recentWinnersLine(ctx.workspaceId);
      const res = await runAiCompletion('script', { prompt: `Propose ONE fresh short-form content idea for ${theme}: a hook + a one-line premise.${winners}`, workspaceId: ctx.workspaceId, label: 'Content idea' });
      const body = res.ok && res.text ? res.text : `A fresh idea for ${theme}: a 45-second explainer opening on a bold question, then a punchy 3-beat payoff.`;
      return { kind: 'content-idea', title: `Content idea for ${theme}`, body };
    },
  });
}
