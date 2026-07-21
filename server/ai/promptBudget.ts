//? Central character budget for one-shot AI requests. Character limits are provider-independent and
//? intentionally conservative (~16k tokens worst-case) so workspace instructions and enabled skills
//? cannot crowd out the feature's authoritative system contract or current user request.

import type { AiCompletionRequest } from './types';

export const AI_PROMPT_BUDGET = {
  prompt: 20_000,
  coreSystem: 32_000,
  workspaceInstruction: 4000,
  skills: 6000,
  productCapabilities: 2000,
  total: 64_000,
} as const;

function bounded(text: string, maxChars: number): string {
  const value = text.trim();
  if (value.length <= maxChars) return value;
  const marker = '\n…[truncated by AI prompt budget]…\n';
  const remaining = maxChars - marker.length;
  const head = Math.ceil(remaining * 0.7);
  return `${value.slice(0, head)}${marker}${value.slice(value.length - (remaining - head))}`;
}

export function applyAiPromptBudget(input: {
  request: AiCompletionRequest;
  workspaceInstruction: string;
  skills: string;
  productCapabilities: string;
}): AiCompletionRequest {
  const prompt = bounded(input.request.prompt, AI_PROMPT_BUDGET.prompt);
  const parts = [
    bounded(input.productCapabilities, AI_PROMPT_BUDGET.productCapabilities),
    bounded(input.workspaceInstruction, AI_PROMPT_BUDGET.workspaceInstruction),
    bounded(input.skills, AI_PROMPT_BUDGET.skills),
    bounded(input.request.system ?? '', AI_PROMPT_BUDGET.coreSystem),
  ].filter((part) => part.length > 0);
  let system = parts.join('\n\n');
  const systemLimit = AI_PROMPT_BUDGET.total - prompt.length;
  if (system.length > systemLimit) system = bounded(system, systemLimit);
  return { ...input.request, prompt, system };
}
