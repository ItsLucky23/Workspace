//? The ONE definition of how an AI prompt is composed (ADR 0311, supersedes 0308) — and since F-075
//? the definition the SERVER builds from, not a description of it.
//?
//? Five free-text fields feed one agent run, spread over two pages, and nothing stated how they
//? combine. ADR 0308 answered with a single ordered stack of five; ADR 0311 corrected that to TWO
//? INDEPENDENT CHANNELS. Both were written from the UI outward and then checked against
//? `server/orchestrator/renderStage.ts` by hand — and the 0311 version still lied twice: it put the
//? handover instruction at system position 3 (the server has the INCOMING handover there and the
//? handover instruction at 6), and it left out the definition of done entirely. A mirror maintained by
//? hand drifts; the fix is to stop mirroring.
//?
//? So this file exports the ORDERED SPEC of every prompt segment, and the server maps over it:
//?   • `AI_STAGE_SYSTEM_SPEC`  → renderStage's `stageInstructions` (the `--append-system-prompt` channel)
//?   • `AI_STAGE_PROJECT_SPEC` → renderStage's `claudeMd` (the CLAUDE.md project-brief channel)
//?   • `AI_ONESHOT_SPEC`       → promptBudget's single system string (chat / docs / content / studio …)
//? Each entry either carries the editable `layer` that feeds it, or is server machinery (fixed text the
//? server adds — the incoming handover, the carry-over fence, the security policy …). The preview shows
//? both, so a user sees their field at its REAL position among everything the agent receives.
//?
//? The formatting helpers at the bottom are the same reason: the server used to prepend the language
//? directive and wrap the skills block in code the preview could not see, so the composed text on
//? screen was never what the agent got. Both sides call these now.
//? @adr 0311

import type { AiSkillEntry, PipelineStageCfg, Workspace } from '../_data/types';

/** Two composition modes: a pipeline STAGE (two channels) or a ONE-SHOT feature (one system string). */
export type AiPromptMode = 'stage' | 'oneShot';

/** The routes a prompt fragment travels to reach the agent. They do not mix. */
export type AiLayerChannel = 'system' | 'project' | 'oneShot';
export const AI_CHANNELS_BY_MODE: Record<AiPromptMode, readonly AiLayerChannel[]> = {
  stage: ['system', 'project'],
  oneShot: ['oneShot'],
};

/** The EDITABLE layers — the fields a user types into. */
export const AI_LAYER_ORDER = ['workspace', 'skills', 'stageSystemPrompt', 'stageInstructions', 'definitionOfDone', 'handoverPrompt'] as const;
export type AiLayerId = (typeof AI_LAYER_ORDER)[number];

/** One segment of a composed prompt: either fed by an editable layer, or fixed server machinery. */
export interface AiPromptEntry<Id extends string = string> {
  id: Id;
  /** The editable field that feeds this segment. Absent = the server adds this text itself. */
  layer?: AiLayerId;
}

//? STAGE — system channel. Mirrors nothing: renderStage builds its array by mapping over THIS.
export const AI_STAGE_SYSTEM_SPEC = [
  { id: 'workspace', layer: 'workspace' },
  { id: 'stageSystemPrompt', layer: 'stageSystemPrompt' },
  //? Composed from the previous stage's ws-carryover envelope (renderIncomingHandover) — not editable.
  { id: 'incomingHandover' },
  { id: 'definitionOfDone', layer: 'definitionOfDone' },
  //? The fence the stage must end with (how the runner detects "done").
  { id: 'carryOverFence' },
  //? The stage's OWN handover instruction sits AFTER the fence it shapes — position 6, not 3.
  { id: 'handoverPrompt', layer: 'handoverPrompt' },
  //? Only emitted when the pipeline has auto-escalation on; empty (and dropped) otherwise.
  { id: 'escalation' },
  { id: 'needsInput' },
  { id: 'questionsPolicy' },
  { id: 'untrustedPolicy' },
] as const satisfies readonly AiPromptEntry[];
export type AiStageSystemEntryId = (typeof AI_STAGE_SYSTEM_SPEC)[number]['id'];

//? STAGE — project channel (CLAUDE.md). The skills block is the LAST context document, so the
//? `skills` layer feeds the `docs` segment rather than a segment of its own.
export const AI_STAGE_PROJECT_SPEC = [
  { id: 'title' },
  { id: 'reload' },
  { id: 'stageInstructions', layer: 'stageInstructions' },
  { id: 'docs', layer: 'skills' },
  { id: 'retrieved' },
  { id: 'untrustedPolicy' },
] as const satisfies readonly AiPromptEntry[];
export type AiStageProjectEntryId = (typeof AI_STAGE_PROJECT_SPEC)[number]['id'];

//? ONE-SHOT — the single system string every non-PTY feature receives (server/ai/promptBudget.ts).
export const AI_ONESHOT_SPEC = [
  { id: 'productCapabilities' },
  { id: 'workspace', layer: 'workspace' },
  { id: 'skills', layer: 'skills' },
  { id: 'featureSystem' },
] as const satisfies readonly AiPromptEntry[];
export type AiOneShotEntryId = (typeof AI_ONESHOT_SPEC)[number]['id'];

export type AiPromptEntryId = AiStageSystemEntryId | AiStageProjectEntryId | AiOneShotEntryId;

export const AI_SPEC_BY_CHANNEL: Record<AiLayerChannel, readonly AiPromptEntry<AiPromptEntryId>[]> = {
  system: AI_STAGE_SYSTEM_SPEC,
  project: AI_STAGE_PROJECT_SPEC,
  oneShot: AI_ONESHOT_SPEC,
};

/** Translation key for each channel's name + the one-line explanation of what it steers. */
export const AI_LAYER_CHANNEL_LABEL_KEY: Record<AiLayerChannel, string> = {
  system: 'workspaces.aiLayers.channelSystem',
  project: 'workspaces.aiLayers.channelProject',
  oneShot: 'workspaces.aiLayers.channelOneShot',
};
export const AI_LAYER_CHANNEL_HELP_KEY: Record<AiLayerChannel, string> = {
  system: 'workspaces.aiLayers.channelSystemHelp',
  project: 'workspaces.aiLayers.channelProjectHelp',
  oneShot: 'workspaces.aiLayers.channelOneShotHelp',
};

/** Translation key for each segment's short name (`workspaces.aiLayers.<id>`). */
export const AI_ENTRY_LABEL_KEY: Record<AiPromptEntryId, string> = {
  workspace: 'workspaces.aiLayers.workspace',
  skills: 'workspaces.aiLayers.skills',
  stageSystemPrompt: 'workspaces.aiLayers.stageSystemPrompt',
  stageInstructions: 'workspaces.aiLayers.stageInstructions',
  definitionOfDone: 'workspaces.aiLayers.definitionOfDone',
  handoverPrompt: 'workspaces.aiLayers.handoverPrompt',
  incomingHandover: 'workspaces.aiLayers.incomingHandover',
  carryOverFence: 'workspaces.aiLayers.carryOverFence',
  escalation: 'workspaces.aiLayers.escalation',
  needsInput: 'workspaces.aiLayers.needsInput',
  questionsPolicy: 'workspaces.aiLayers.questionsPolicy',
  untrustedPolicy: 'workspaces.aiLayers.untrustedPolicy',
  title: 'workspaces.aiLayers.title',
  reload: 'workspaces.aiLayers.reload',
  docs: 'workspaces.aiLayers.docs',
  retrieved: 'workspaces.aiLayers.retrieved',
  productCapabilities: 'workspaces.aiLayers.productCapabilities',
  featureSystem: 'workspaces.aiLayers.featureSystem',
};

export interface ResolvedAiLayer {
  /** The prompt segment. */
  id: AiPromptEntryId;
  /** The editable field feeding it; undefined = server machinery (no text known on the client). */
  layer?: AiLayerId;
  /** Which channel carries this segment. */
  channel: AiLayerChannel;
  /** 1-based position WITHIN its channel, counted over EVERY segment the server emits — there is no
   *  meaningful global position. Static: an empty segment is dropped at run time, the numbering is not. */
  position: number;
  /** How many segments that channel holds, for "position 6 of 10". */
  channelTotal: number;
  /** The segment's current content, formatted as the server emits it. Empty = contributes nothing
   *  right now (or, for machinery, unknown here). */
  text: string;
  /** Where the user edits this segment, for the "edit →" affordance; `server` for machinery. */
  source: 'workspace' | 'stage' | 'server';
}

/* ------------------------------------------------------------ shared formatting (server + preview) */

/** The workspace layer as BOTH paths emit it: the output-language directive, then the instruction.
 *  Was inlined in server/ai/registry.ts `workspaceAiPrefix`, so the preview showed the bare field. */
export function formatWorkspaceInstruction({ outputLanguage, aiInstruction }: { outputLanguage?: string; aiInstruction?: string }): string {
  const parts: string[] = [];
  const lang = (outputLanguage ?? '').trim();
  if (lang.length > 0) parts.push(`Write all output in ${lang}.`);
  const instruction = (aiInstruction ?? '').trim();
  if (instruction.length > 0) parts.push(instruction);
  return parts.join('\n\n');
}

/** The skills block as the server injects it (one-shot system string AND the stage's last context
 *  doc). '' when nothing applies. Was `formatSkillBlock` in server/ai/skills.ts. */
export function formatSkillBlock(skills: readonly { name: string; instruction: string; examples: string }[]): string {
  if (skills.length === 0) return '';
  const blocks = skills.map((s) => {
    const body = s.instruction.trim();
    const ex = s.examples.trim();
    return `### Skill: ${s.name}\n${body}${ex.length > 0 ? `\n\nExamples:\n${ex}` : ''}`;
  });
  return `## Active skills (apply these writing/working instructions to your output)\n\n${blocks.join('\n\n')}`;
}

/** Per-stage "definition of done": set → the AI works toward it; empty → it judges completion itself
 *  (the product owner's choice). Either way the stage ENDS by emitting the ws-carryover block. */
export function formatDoneGuidance(definitionOfDone: string | undefined): string {
  return (definitionOfDone ?? '').trim().length > 0
    ? `This stage is DONE when: ${definitionOfDone ?? ''}. When that is satisfied, end your final message with the fenced block below.`
    : 'Judge for yourself when this stage\'s goal is achieved, then end your final message with the fenced block below.';
}

/** The stage's own handover instruction, wrapped so it shapes the `summary` of the block above it. */
export function formatHandoverPrompt(handoverPrompt: string | undefined): string {
  const text = (handoverPrompt ?? '').trim();
  return text.length > 0 ? `When you write that block, shape its \`summary\` for the next stage as follows: ${text}` : '';
}

/* ------------------------------------------------------------ skills resolution (client mirror) */

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

/** The skills a PIPELINE STAGE actually receives: exactly the ones picked on its Context tab
 *  (`aiSkillIds`), resolved against the workspace's skill list — apply points do not enter into it.
 *  Mirrors `server/ai/skills.ts` resolveSkillsByIds (stageRunner builds the stage block from it, ordered
 *  by slug). F-010: the preview used `applicableSkills('all')` here and so showed the wrong layer. */
export function stagePickedSkills(skills: AiSkillEntry[], aiSkillIds: readonly string[]): AiSkillEntry[] {
  const picked = new Set(aiSkillIds);
  return skills.filter((s) => picked.has(s.id)).toSorted((a, b) => a.slug.localeCompare(b.slug));
}

/* ------------------------------------------------------------ resolution */

/** Compose the segments for a workspace + optional stage.
 *  `mode: 'stage'` (default) renders the two-channel pipeline model; `mode: 'oneShot'` the single
 *  system string of the non-PTY features (what the workspace AI page should show — it has no stage).
 *  A stage that carries `aiSkillIds` resolves its skills from that pick (what stageRunner sends);
 *  `applyPoint` is the rule for the one-shot call sites. With neither, only `['all']` skills show —
 *  each one-shot feature adds its own group's skills on top. */
export function resolveAiLayers({ workspace, skills, stage, applyPoint, mode = 'stage' }: {
  workspace: Pick<Workspace, 'aiInstruction' | 'outputLanguage'>;
  skills: AiSkillEntry[];
  stage?: Pick<PipelineStageCfg, 'systemPrompt' | 'customInstructions' | 'handoverPrompt' | 'definitionOfDone'> & Partial<Pick<PipelineStageCfg, 'aiSkillIds'>>;
  applyPoint?: string;
  mode?: AiPromptMode;
}): ResolvedAiLayer[] {
  const skillSet = stage?.aiSkillIds === undefined ? applicableSkills(skills, applyPoint) : stagePickedSkills(skills, stage.aiSkillIds);
  const definitionOfDone = stage?.definitionOfDone ?? '';

  const text: Record<AiLayerId, string> = {
    workspace: formatWorkspaceInstruction(workspace),
    skills: formatSkillBlock(skillSet),
    stageSystemPrompt: (stage?.systemPrompt ?? '').trim(),
    stageInstructions: (stage?.customInstructions ?? '').trim(),
    //? Empty shows as "not set" although the server then emits its own default line; the default
    //? is the machinery half and belongs to the server, not to the field.
    definitionOfDone: definitionOfDone.trim().length > 0 ? formatDoneGuidance(definitionOfDone) : '',
    handoverPrompt: formatHandoverPrompt(stage?.handoverPrompt),
  };
  const source: Record<AiLayerId, 'workspace' | 'stage'> = {
    workspace: 'workspace', skills: 'workspace', stageSystemPrompt: 'stage', stageInstructions: 'stage', definitionOfDone: 'stage', handoverPrompt: 'stage',
  };

  //? Emitted channel by channel, so the list a user reads is the order the agent receives.
  return AI_CHANNELS_BY_MODE[mode].flatMap((channel) => {
    const spec = AI_SPEC_BY_CHANNEL[channel];
    return spec.map((entry, index): ResolvedAiLayer => ({
      id: entry.id,
      ...(entry.layer === undefined ? {} : { layer: entry.layer }),
      channel,
      position: index + 1,
      channelTotal: spec.length,
      text: entry.layer === undefined ? '' : text[entry.layer],
      source: entry.layer === undefined ? 'server' : source[entry.layer],
    }));
  });
}

/** The segments of one channel, in order — what that channel actually carries. */
export function layersInChannel(layers: ResolvedAiLayer[], channel: AiLayerChannel): ResolvedAiLayer[] {
  return layers.filter((l) => l.channel === channel).toSorted((a, b) => a.position - b.position);
}

/** The channels present in a resolved set, in emission order. */
export function channelsOf(layers: ResolvedAiLayer[]): AiLayerChannel[] {
  return [...new Set(layers.map((l) => l.channel))];
}

/** The segment an editable layer feeds, if it is part of this resolved set. */
export function layerEntry(layers: ResolvedAiLayer[], layer: AiLayerId): ResolvedAiLayer | undefined {
  return layers.find((l) => l.layer === layer);
}

/** How many segments are editable fields — the "n of total active" denominator. */
export function editableCount(layers: ResolvedAiLayer[]): number {
  return layers.filter((l) => l.layer !== undefined).length;
}

/** One channel's composed text, as far as the client can know it: the contributing EDITABLE segments,
 *  in order, each formatted as the server emits it. Machinery segments are listed, not composed.
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
