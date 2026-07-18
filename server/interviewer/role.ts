//? Interviewer ⇄ AgentRole bridge. Registers the Interviewer as a pluggable, NON-coding agent role
//? so a WorkspaceTrigger (e.g. a weekly cron) can run it via `invoke-agent-role` and surface its
//? proposal in the system (the executor records the returned artifact as a notification). Reasons via
//? the pluggable AI-provider layer (feature `interviewer`, ADR 0007). Call `registerInterviewerRole()`
//? once at boot. Workspace-scoped (invariant B-4); `mutates:false` — it proposes, never writes.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';
import { retrieve } from '../rag/index';
import { retrieveProductKnowledge } from '../rag/productKnowledge';
import { resolveProjectId } from '../orchestrator/projectResolve';
import { parseFindings, recordFindings } from './findings';
import { renderUntrustedContext, UNTRUSTED_CONTEXT_POLICY } from '../ai/untrustedContext';

//? Pure prompt builder (unit-testable). `focus` narrows the review (e.g. "the auth flow"); empty =
//? the whole project. `context` is retrieved codebase excerpts (RAG) that GROUND the ideas in the
//? real project — empty when nothing is indexed (then it reasons from the brief only).
//? `productContext` (zelf-bewuste-AI-brug) is the PRODUCT-knowledge corpus — what THIS platform can
//? do — kept as a separate section so ideas can lean on real platform capabilities, which matters
//? most for content/design workspaces that have no code index at all.
export function buildInterviewerPrompt(focus: string, context = '', productContext = ''): { system: string; prompt: string } {
  const scope = focus.trim().length > 0 ? focus.trim() : 'the whole project';
  const grounding = context.trim().length > 0
    ? `\n\nGROUND your ideas in these real excerpts from the codebase (cite the file when relevant):\n${renderUntrustedContext({ provenance: 'RAG chunks: repository excerpts', content: context.trim(), maxChars: 6000 })}`
    : '';
  const productGrounding = productContext.trim().length > 0
    ? `\n\nPLATFORM CAPABILITIES (what this workspace platform itself offers — use these when an idea can be realised with an existing module):\n${renderUntrustedContext({ provenance: 'RAG chunks: product capabilities', content: productContext.trim(), maxChars: 3000 })}`
    : '';
  return {
    system: 'You are a sharp senior engineer reviewing a software project and proposing improvements. Output 3–5 concise, concrete, actionable ideas as a short markdown list. Each line MUST be exactly: `- [area] **Title** — one sentence on why it matters`, where area is ONE of reliability, dx, ux, performance, security, product. No preamble, no filler.',
    prompt: `Propose the highest-value improvements for ${scope}. Prefer things a small team could actually ship soon. Return a short markdown list, one idea per line in the "- [area] **Title** — why" format.${grounding}${productGrounding}${grounding || productGrounding ? `\n\n${UNTRUSTED_CONTEXT_POLICY}` : ''}`,
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
      //? R3-b — scope to the trigger's target project (or the workspace's first) so a multi-project
      //? workspace grounds on a DETERMINISTIC project, not whichever one indexed last.
      const query = focus.trim().length > 0 ? focus : 'architecture, reliability, code quality, UX, security, product gaps';
      const projId = await resolveProjectId(getPrismaClient(), ctx.workspaceId, typeof ctx.params.projectId === 'string' ? ctx.params.projectId : null);
      const [, chunks] = await tryCatch(() => retrieve(getPrismaClient(), ctx.workspaceId, query, 6, undefined, projId ?? undefined));
      const context = (chunks ?? []).map((c) => `// ${c.filePath}\n${c.content}`).join('\n\n').slice(0, 6000);
      //? Zelf-bewuste-AI-brug: also ground on the product-knowledge corpus (was chat-only) so ideas
      //? for content/design workspaces (no code index) stop being generic bullets.
      const [, pk] = await tryCatch(() => retrieveProductKnowledge(getPrismaClient(), query, 3));
      const productContext = (pk ?? []).map((c) => c.content).join('\n\n').slice(0, 3000);
      const { system, prompt } = buildInterviewerPrompt(focus, context, productContext);
      const [error, res] = await tryCatch(() => runAiCompletion('interviewer', { prompt, system, timeoutMs: 180_000, workspaceId: ctx.workspaceId, label: 'Interviewer · improvement ideas' }));
      if (error || !res?.ok || res.text.trim().length === 0) return { kind: 'interview-result', title: 'Interviewer', body: 'Could not generate ideas this run — try again.' };
      //? Persist the ideas as CATEGORISED findings (ADR 0034) so they survive + can become tickets.
      const [, count] = await tryCatch(() => recordFindings(getPrismaClient(), ctx.workspaceId, parseFindings(res.text)));
      const n = count ?? 0;
      return { kind: 'interview-result', title: 'Ideas from the Interviewer', body: `${n > 0 ? `${String(n)} new finding${n === 1 ? '' : 's'} saved.\n\n` : ''}${res.text.trim()}` };
    },
  });
}
