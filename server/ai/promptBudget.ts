//? Central character budget for one-shot AI requests. Character limits are provider-independent and
//? intentionally conservative (~16k tokens worst-case) so workspace instructions and enabled skills
//? cannot crowd out the feature's authoritative system contract or current user request.

import type { AiCompletionRequest } from './types';
import { AI_ONESHOT_SPEC, type AiOneShotEntryId } from '../../src/workspaces/_functions/aiLayers';

export const AI_PROMPT_BUDGET = {
  prompt: 20_000,
  coreSystem: 32_000,
  workspaceInstruction: 4000,
  skills: 6000,
  productCapabilities: 2000,
  total: 64_000,
} as const;

type PromptBudget = { [K in keyof typeof AI_PROMPT_BUDGET]: number };

//? Rough chars→tokens, the same ~4:1 the spend estimator uses. Budgets are counted in CHARACTERS
//? (provider-independent); the operator-facing knob is in TOKENS, because that is what a context
//? window is quoted in.
const CHARS_PER_TOKEN = 4;

//? How many tokens of CONVERSATION the assistant may carry before the compaction layer folds the
//? oldest turns into a summary (server/ai/chatCompaction.ts). Owner 2026-08-26: "een auto compact
//? layer voor zijn context window als die boven de e.g. 272k tokens komt". Tunable per host, because
//? the honest ceiling is the context window of whichever backend actually serves the chat.
export const CHAT_CONTEXT_TOKENS = Math.max(8000, Number(process.env.WS_CHAT_CONTEXT_TOKENS ?? '272000'));

//? Per-feature budget overrides. The default above is deliberately small — a one-shot generation must
//? not let a workspace instruction crowd out its own contract. The CHAT is the exception: it is a
//? CONVERSATION, and clipping its history at 20k chars is exactly the "fire and forget" the owner
//? asked us to remove. Its prompt is sized to the compaction ceiling, so the layer below decides what
//? the assistant remembers — not a truncation marker in the middle of an old turn.
const FEATURE_BUDGET: Record<string, PromptBudget> = {
  'workspace-chat': {
    ...AI_PROMPT_BUDGET,
    prompt: CHAT_CONTEXT_TOKENS * CHARS_PER_TOKEN,
    total: CHAT_CONTEXT_TOKENS * CHARS_PER_TOKEN + AI_PROMPT_BUDGET.coreSystem + AI_PROMPT_BUDGET.workspaceInstruction + AI_PROMPT_BUDGET.skills + AI_PROMPT_BUDGET.productCapabilities,
  },
};

export const budgetForFeature = (feature: string): PromptBudget => FEATURE_BUDGET[feature] ?? AI_PROMPT_BUDGET;

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
  //? Which feature is running, so a conversational surface can carry a conversation-sized prompt while
  //? every one-shot generation keeps the tight default. Omitted → the default budget.
  feature?: string;
}): AiCompletionRequest {
  const budget = budgetForFeature(input.feature ?? '');
  const prompt = bounded(input.request.prompt, budget.prompt);
  const segment: Record<AiOneShotEntryId, string> = {
    productCapabilities: bounded(input.productCapabilities, budget.productCapabilities),
    workspace: bounded(input.workspaceInstruction, budget.workspaceInstruction),
    skills: bounded(input.skills, budget.skills),
    featureSystem: bounded(input.request.system ?? '', budget.coreSystem),
  };
  //? Ordered by the shared spec (aiLayers.ts) so the preview's one-shot model cannot drift (F-075).
  const parts = AI_ONESHOT_SPEC.map((entry) => segment[entry.id]).filter((part) => part.length > 0);
  let system = parts.join('\n\n');
  const systemLimit = budget.total - prompt.length;
  if (system.length > systemLimit) system = bounded(system, systemLimit);
  return { ...input.request, prompt, system };
}
