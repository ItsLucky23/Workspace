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
