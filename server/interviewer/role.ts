//? Interviewer ⇄ AgentRole bridge. Registers the Interviewer as a pluggable, NON-coding agent role
//? so a WorkspaceTrigger (e.g. a weekly cron) can run it via `invoke-agent-role` and surface its
//? proposal in the system (the executor records the returned artifact as a notification). Reasons via
//? the pluggable AI-provider layer (feature `interviewer`, ADR 0007). Call `registerInterviewerRole()`
//? once at boot. Workspace-scoped (invariant B-4); `mutates:false` — it proposes, never writes.

import { tryCatch } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';

//? Pure prompt builder (unit-testable). `focus` narrows the review (e.g. "the auth flow"); empty =
//? the whole project.
export function buildInterviewerPrompt(focus: string): { system: string; prompt: string } {
  const scope = focus.trim().length > 0 ? focus.trim() : 'the whole project';
  return {
    system: 'You are a sharp senior engineer reviewing a software project and proposing improvements. Output 3–5 concise, concrete, actionable ideas as a short markdown list. Each idea is a bold one-line title followed by one sentence on why it matters. No preamble, no filler.',
    prompt: `Propose the highest-value improvements for ${scope}. Prefer things a small team could actually ship soon — reliability, developer experience, UX, performance, security, or product gaps. Return a short markdown list.`,
  };
}

export function registerInterviewerRole(): void {
  registerAgentRole({
    key: 'interviewer',
    label: 'Interviewer',
    description: 'Reasons over the project and proposes concrete improvement ideas.',
    mutates: false,
    run: async (ctx) => {
      const focus = typeof ctx.params.focus === 'string' ? ctx.params.focus : '';
      const { system, prompt } = buildInterviewerPrompt(focus);
      const [error, res] = await tryCatch(() => runAiCompletion('interviewer', { prompt, system, timeoutMs: 180_000, workspaceId: ctx.workspaceId, label: 'Interviewer · improvement ideas' }));
      if (error || !res?.ok || res.text.trim().length === 0) return { kind: 'interview-result', title: 'Interviewer', body: 'Could not generate ideas this run — try again.' };
      return { kind: 'interview-result', title: 'Ideas from the Interviewer', body: res.text.trim() };
    },
  });
}
