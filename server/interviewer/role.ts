//? Interviewer ⇄ AgentRole bridge. Registers the Interviewer as a pluggable, NON-coding agent role
//? so a WorkspaceTrigger (e.g. a weekly cron) can run it via `invoke-agent-role` and surface its
//? proposal in the system (the executor records the returned artifact as a notification). Reasons via
//? the pluggable AI-provider layer (feature `interviewer`, ADR 0007). Call `registerInterviewerRole()`
//? once at boot. Workspace-scoped (invariant B-4); `mutates:false` — it proposes, never writes.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';
import { retrieve } from '../rag/index';
import { parseFindings, recordFindings } from './findings';

//? Pure prompt builder (unit-testable). `focus` narrows the review (e.g. "the auth flow"); empty =
//? the whole project. `context` is retrieved codebase excerpts (RAG) that GROUND the ideas in the
//? real project — empty when nothing is indexed (then it reasons from the brief only).
export function buildInterviewerPrompt(focus: string, context = ''): { system: string; prompt: string } {
  const scope = focus.trim().length > 0 ? focus.trim() : 'the whole project';
  const grounding = context.trim().length > 0
    ? `\n\nGROUND your ideas in these real excerpts from the codebase (cite the file when relevant):\n${context.trim()}`
    : '';
  return {
    system: 'You are a sharp senior engineer reviewing a software project and proposing improvements. Output 3–5 concise, concrete, actionable ideas as a short markdown list. Each line MUST be exactly: `- [area] **Title** — one sentence on why it matters`, where area is ONE of reliability, dx, ux, performance, security, product. No preamble, no filler.',
    prompt: `Propose the highest-value improvements for ${scope}. Prefer things a small team could actually ship soon. Return a short markdown list, one idea per line in the "- [area] **Title** — why" format.${grounding}`,
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
      //? Ground the ideas in the real codebase via RAG (top chunks for the focus, or a broad query).
      const query = focus.trim().length > 0 ? focus : 'architecture, reliability, code quality, UX, security, product gaps';
      const [, chunks] = await tryCatch(() => retrieve(getPrismaClient(), ctx.workspaceId, query, 6));
      const context = (chunks ?? []).map((c) => `// ${c.filePath}\n${c.content}`).join('\n\n').slice(0, 6000);
      const { system, prompt } = buildInterviewerPrompt(focus, context);
      const [error, res] = await tryCatch(() => runAiCompletion('interviewer', { prompt, system, timeoutMs: 180_000, workspaceId: ctx.workspaceId, label: 'Interviewer · improvement ideas' }));
      if (error || !res?.ok || res.text.trim().length === 0) return { kind: 'interview-result', title: 'Interviewer', body: 'Could not generate ideas this run — try again.' };
      //? Persist the ideas as CATEGORISED findings (ADR 0034) so they survive + can become tickets.
      const [, count] = await tryCatch(() => recordFindings(getPrismaClient(), ctx.workspaceId, parseFindings(res.text)));
      const n = count ?? 0;
      return { kind: 'interview-result', title: 'Ideas from the Interviewer', body: `${n > 0 ? `${String(n)} new finding${n === 1 ? '' : 's'} saved.\n\n` : ''}${res.text.trim()}` };
    },
  });
}
