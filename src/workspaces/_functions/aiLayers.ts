//? The ONE definition of how a Develop-pipeline agent's prompt is composed (ADR 0311, supersedes 0308).
//?
//? Five separate free-text fields feed one agent run, spread over two pages, and nothing stated how
//? they combine — the only hint read "layered above your instructions" without ever saying above WHAT.
//? ADR 0308 answered that with a single ordered stack of five. That answer was WRONG: it was written
//? from the UI outward and never checked against `server/orchestrator/renderStage.ts`, which composes
//? TWO INDEPENDENT CHANNELS reaching the agent by different routes:
//?
//?   • the SYSTEM channel (`--append-system-prompt`): workspace steering → the stage's system prompt →
//?     the carry-over template filled with the previous stage's handoff. How the agent should behave.
//?   • the PROJECT channel (`CLAUDE.md` on the container's /work volume): the stage's task instructions
//?     verbatim → context documents, including the active skills block → RAG excerpts. What it works on.
//?
//? A layer therefore has no global position — "layer 4 of 5" was meaningless, and worse, it implied
//? that layer 3 constrains layer 4 when they are not even in the same file. Position is per channel.
//?
//? Layer 1 carried a real defect alongside the wrong story: `Workspace.aiInstruction` is documented, in
//? the op catalog and in the settings UI, as "prepended to every AI run" — but it was applied only at
//? the one-shot choke-point in `server/ai/registry.ts`. The PTY coding agent renders its own prompt and
//? never read it, so the one instruction a user writes to steer everything skipped the thing that
//? writes their code. ADR 0311 fixes the server rather than documenting the gap.
//?
//? Everything that renders or explains the composition reads from here. Adding a layer means editing
//? this file AND renderStage.ts — and if those two ever disagree again, this file is the one that lies.
//? @adr 0311

import type { AiSkillEntry, PipelineStageCfg, Workspace } from '../_data/types';

/** The two routes a prompt fragment travels to reach the agent. They do not mix. */
export const AI_LAYER_CHANNEL_ORDER = ['system', 'project'] as const;
export type AiLayerChannel = (typeof AI_LAYER_CHANNEL_ORDER)[number];

/** Every layer, grouped by the channel it actually travels in, each in its real order.
 *  Mirrors `stageInstructions[]` and `claudeMd` in server/orchestrator/renderStage.ts. */
export const AI_LAYER_ORDER_BY_CHANNEL: Record<AiLayerChannel, readonly AiLayerId[]> = {
  system: ['workspace', 'stageSystemPrompt', 'carryOver'],
  project: ['stageInstructions', 'skills'],
};

export const AI_LAYER_ORDER = ['workspace', 'skills', 'stageSystemPrompt', 'stageInstructions', 'carryOver'] as const;
export type AiLayerId = (typeof AI_LAYER_ORDER)[number];

/** Translation key for each channel's name + the one-line explanation of what it steers. */
export const AI_LAYER_CHANNEL_LABEL_KEY: Record<AiLayerChannel, string> = {
  system: 'workspaces.aiLayers.channelSystem',
  project: 'workspaces.aiLayers.channelProject',
};
export const AI_LAYER_CHANNEL_HELP_KEY: Record<AiLayerChannel, string> = {
  system: 'workspaces.aiLayers.channelSystemHelp',
  project: 'workspaces.aiLayers.channelProjectHelp',
};

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
  /** Which of the two channels carries this layer. */
  channel: AiLayerChannel;
  /** 1-based position WITHIN its channel — there is no meaningful global position. */
  position: number;
  /** How many layers that channel holds, for "position 2 of 3". */
  channelTotal: number;
  /** The field's current content. Empty means the layer contributes nothing right now. */
  text: string;
  /** Where the user edits this layer, for the "edit →" affordance. */
  source: 'workspace' | 'stage';
}

/** Total layer count across both channels — used only for "3 of 5 fields are filled in". */
export const AI_LAYER_COUNT = AI_LAYER_ORDER.length;

/** Where a layer sits: its channel and its 1-based position inside it. */
export function layerPlacement(id: AiLayerId): { channel: AiLayerChannel; position: number; channelTotal: number } {
  for (const channel of AI_LAYER_CHANNEL_ORDER) {
    const order = AI_LAYER_ORDER_BY_CHANNEL[channel];
    const index = order.indexOf(id);
    if (index !== -1) return { channel, position: index + 1, channelTotal: order.length };
  }
  //? Unreachable while AI_LAYER_ORDER_BY_CHANNEL covers every id — the structural test pins that.
  return { channel: 'system', position: 1, channelTotal: 1 };
}

/** Which skills apply AUTOMATICALLY to a run. `['all']` means every AI run; an explicit list applies
 *  only when the run's apply-point matches; EMPTY means nowhere automatic — such a skill runs only
 *  where a pipeline stage picked it by id.
 *
 *  Mirrors `resolveSkillsFor` in server/ai/skills.ts. The separate `enabled` flag is gone: two
 *  controls that both meant "off" is why a skill could be on and still do nothing. */
export function applicableSkills(skills: AiSkillEntry[], applyPoint?: string): AiSkillEntry[] {
  return skills.filter((s) => {
    if (s.applyPoints.includes('all')) return true;
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

  const text: Record<AiLayerId, string> = {
    workspace: (workspace.aiInstruction ?? '').trim(),
    skills: skillText,
    stageSystemPrompt: (stage?.systemPrompt ?? '').trim(),
    stageInstructions: (stage?.customInstructions ?? '').trim(),
    carryOver: (stage?.promptTemplate ?? '').trim(),
  };
  const source: Record<AiLayerId, 'workspace' | 'stage'> = {
    workspace: 'workspace', skills: 'workspace', stageSystemPrompt: 'stage', stageInstructions: 'stage', carryOver: 'stage',
  };

  //? Emitted channel by channel, so the list a user reads is the order the agent receives.
  return AI_LAYER_CHANNEL_ORDER.flatMap((channel) =>
    AI_LAYER_ORDER_BY_CHANNEL[channel].map((id, index) => ({
      id,
      channel,
      position: index + 1,
      channelTotal: AI_LAYER_ORDER_BY_CHANNEL[channel].length,
      text: text[id],
      source: source[id],
    })));
}

/** The layers of one channel, in order — what that channel actually carries. */
export function layersInChannel(layers: ResolvedAiLayer[], channel: AiLayerChannel): ResolvedAiLayer[] {
  return layers.filter((l) => l.channel === channel).toSorted((a, b) => a.position - b.position);
}

/** One channel's composed text, as the agent receives it: contributing layers only, in order.
 *  Deliberately per channel — concatenating both would recreate the fiction ADR 0311 removed. */
export function composeChannel(layers: ResolvedAiLayer[], channel: AiLayerChannel): string {
  return layersInChannel(layers, channel).filter((l) => l.text.length > 0).map((l) => l.text).join('\n\n');
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
