//? Content ideator role (F3.3, ADR 0067) — a SCHEDULABLE content-generation role. A cron trigger
//? (`action:'invoke-agent-role', params:{role:'content-ideator', theme?}`) fires it; because it `mutates`
//? (proposing content is a write path), the automation executor GATES it into an approval suggestion — it
//? never writes content directly (B-23). Call `registerContentIdeatorRole()` once at boot.

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';

export function registerContentIdeatorRole(): void {
  registerAgentRole({
    key: 'content-ideator',
    label: 'Content ideator',
    description: 'Proposes a fresh content idea for a channel on a schedule (gated to a suggestion — B-23).',
    mutates: true,
    run: async (ctx) => {
      const theme = typeof ctx.params.theme === 'string' && ctx.params.theme ? ctx.params.theme : 'your channel';
      const res = await runAiCompletion('script', { prompt: `Propose ONE fresh short-form content idea for ${theme}: a hook + a one-line premise.`, workspaceId: ctx.workspaceId, label: 'Content idea' });
      const body = res.ok && res.text ? res.text : `A fresh idea for ${theme}: a 45-second explainer opening on a bold question, then a punchy 3-beat payoff.`;
      return { kind: 'content-idea', title: `Content idea for ${theme}`, body };
    },
  });
}
