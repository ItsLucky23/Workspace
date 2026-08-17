//? The ONE definition of how a Develop-pipeline agent's prompt is composed (ADR 0308).
//?
//? Five separate free-text fields feed one agent prompt, spread over two pages, and until now
//? nothing stated the order — the only hint in the UI read "layered above your instructions"
//? without ever saying above WHAT. A user editing seven stages plus the workspace could not tell
//? whether the workspace instruction was a default, a floor, or something a stage silently
//? replaced. ADR 0308 settles it: STRICT layering, always concatenated in the order below, no
//? per-stage opt-out.
//?
//? Everything that renders or explains the composition reads from here, so adding a sixth layer
//? later means editing this file and nothing else.

import type { AiSkillEntry, PipelineStageCfg, Workspace } from '../_data/types';

/** The layers, in the exact order they reach the agent. Index + 1 is the human "layer N of 5". */
export const AI_LAYER_ORDER = ['workspace', 'skills', 'stageSystemPrompt', 'stageInstructions', 'carryOver'] as const;
export type AiLayerId = (typeof AI_LAYER_ORDER)[number];

/** Translation key for each layer's short name (`workspaces.aiLayers.<id>`). */
export const AI_LAYER_LABEL_KEY: Record<AiLayerId, string> = {
  workspace: 'workspaces.aiLayers.workspace',
  skills: 'workspaces.aiLayers.skills',
  stageSystemPrompt: 'workspaces.aiLayers.stageSystemPrompt',
  stageInstructions: 'workspaces.aiLayers.stageInstructions',
  carryOver: 'workspaces.aiLayers.carryOver',
};

export interface ResolvedAiLayer {
  id: AiLayerId;
  /** 1-based position, for "layer 3 of 5". */
  position: number;
  /** The field's current content. Empty means the layer contributes nothing right now. */
  text: string;
  /** Where the user edits this layer, for the "edit →" affordance. */
  source: 'workspace' | 'stage';
}

/** Total layer count — the "of 5" half of the inheritance note. */
export const AI_LAYER_COUNT = AI_LAYER_ORDER.length;

/** Which skills actually apply to a run. `[]` or `['all']` on a skill means "every AI run"; an
 *  explicit list applies only when the run's apply-point matches. Disabled skills never apply. */
export function applicableSkills(skills: AiSkillEntry[], applyPoint?: string): AiSkillEntry[] {
  return skills.filter((s) => {
    if (!s.enabled) return false;
    if (s.applyPoints.length === 0 || s.applyPoints.includes('all')) return true;
    return applyPoint !== undefined && s.applyPoints.includes(applyPoint);
  });
}

/** Compose the layers for a given workspace + optional stage. Passing no stage resolves only the
 *  workspace-wide half (layers 1-2) — which is exactly what the workspace settings page shows. */
export function resolveAiLayers({ workspace, skills, stage, applyPoint }: {
  workspace: Pick<Workspace, 'aiInstruction'>;
  skills: AiSkillEntry[];
  stage?: Pick<PipelineStageCfg, 'systemPrompt' | 'customInstructions' | 'promptTemplate'>;
  applyPoint?: string;
}): ResolvedAiLayer[] {
  const skillText = applicableSkills(skills, applyPoint)
    .map((s) => s.instruction.trim())
    .filter((t) => t.length > 0)
    .join('\n\n');

  return [
    { id: 'workspace', position: 1, text: (workspace.aiInstruction ?? '').trim(), source: 'workspace' },
    { id: 'skills', position: 2, text: skillText, source: 'workspace' },
    { id: 'stageSystemPrompt', position: 3, text: (stage?.systemPrompt ?? '').trim(), source: 'stage' },
    { id: 'stageInstructions', position: 4, text: (stage?.customInstructions ?? '').trim(), source: 'stage' },
    { id: 'carryOver', position: 5, text: (stage?.promptTemplate ?? '').trim(), source: 'stage' },
  ];
}

/** The composed prompt exactly as the agent receives it: contributing layers only, in order. */
export function composeEffectivePrompt(layers: ResolvedAiLayer[]): string {
  return layers.filter((l) => l.text.length > 0).map((l) => l.text).join('\n\n');
}

//? ---- Content/Studio/Marketing profile (duplicateConcepts #2 — a SECOND, unrelated layering stack) ----
//? brief.tone, the workspace's central brand.voice and a per-generation refine instruction all steer
//? ONE Studio/Marketing artifact generation, and nothing stated how they combine. Order verified against
//? server/studio/generate.ts: `briefBlock()` folds brief tone into the base prompt, then (if the brand
//? library has a palette or voice) appends brand voice; `applyRefine()` appends the refine text LAST —
//? so refine has the strongest, most immediate effect, not the weakest, despite reading "first" in the
//? owner's shorthand. Channel brand voice (Content settings → Channels) is a THIRD, separate axis: it
//? shapes posts published to a channel, never a Studio/Marketing generation, so it's listed but always
//? inert here (`applicable: false`) — same "say what the other one does" principle as the InfoDot pattern.
export const CONTENT_LAYER_ORDER = ['briefTone', 'brandVoice', 'refine', 'channelVoice'] as const;
export type ContentLayerId = (typeof CONTENT_LAYER_ORDER)[number];

export const CONTENT_LAYER_LABEL_KEY: Record<ContentLayerId, string> = {
  briefTone: 'workspaces.aiLayers.briefTone',
  brandVoice: 'workspaces.aiLayers.brandVoice',
  refine: 'workspaces.aiLayers.refine',
  channelVoice: 'workspaces.aiLayers.channelVoice',
};

export const CONTENT_LAYER_COUNT = CONTENT_LAYER_ORDER.length;

export interface ResolvedContentLayer {
  id: ContentLayerId;
  position: number;
  text: string;
  source: 'brief' | 'brand' | 'refine' | 'channel';
  /** false only for channelVoice: it never feeds a Studio/Marketing generation, so an empty layer
   *  here means "not part of this prompt", not "not set yet". */
  applicable: boolean;
}

export function resolveContentAiLayers({ briefTone, brandVoice, refine }: {
  briefTone?: string;
  brandVoice?: string;
  refine?: string;
}): ResolvedContentLayer[] {
  return [
    { id: 'briefTone', position: 1, text: (briefTone ?? '').trim(), source: 'brief', applicable: true },
    { id: 'brandVoice', position: 2, text: (brandVoice ?? '').trim(), source: 'brand', applicable: true },
    { id: 'refine', position: 3, text: (refine ?? '').trim(), source: 'refine', applicable: true },
    { id: 'channelVoice', position: 4, text: '', source: 'channel', applicable: false },
  ];
}

/** The composed prompt exactly as Studio/Marketing generation receives it — mirrors buildPrompt()
 *  + applyRefine() in server/studio/generate.ts (contributing, applicable layers only, in order). */
export function composeEffectiveContentPrompt(layers: ResolvedContentLayer[]): string {
  return layers.filter((l) => l.applicable && l.text.length > 0).map((l) => l.text).join('\n\n');
}
