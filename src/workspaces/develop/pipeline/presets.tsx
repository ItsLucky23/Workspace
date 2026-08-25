//? Pipeline PRESETS on an existing project (owner decision 2026-08-18).
//?
//? The tier — simple / advanced / professional — was asked once, when the workspace was created, and was
//? then unreachable: a project created afterwards always got the 7-stage flow, and there was no way to
//? change your mind. Worse, a pipeline seeded before the defaults carried prompt text (and every stage
//? added by hand) is BLANK: no persona, no instructions, no carry-over template. The board looks
//? configured while its agents run on nothing, which is the least legible failure this product has.
//?
//? Two actions, deliberately different in weight:
//?   Fill   — writes the canonical blueprint into the fields that are EMPTY and removes nothing. Safe.
//?   Switch — structural: adds the preset's missing stages, drops the default stages it does not have,
//?            and moves their tickets back. Confirmed, and the confirm states the real numbers first.
//?
//? The blueprints come from the server (`workspaces/pipelinePresets/v1`) rather than a copy in `src/`,
//? because `server/bootstrap/defaultPipeline.ts` is what actually seeds a pipeline — a second copy would
//? drift silently while the UI kept promising "the default".

/* eslint-disable react-refresh/only-export-components -- the presets hook and the menu that renders it are one feature; splitting a 20-line hook into its own file only satisfies a dev-only fast-refresh rule. Not a route component. */
import { useEffect, useRef, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import { PopMenu, type PopMenuItem } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { PipelineStageCfg } from '../../_data/types';

export const PRESET_KEYS = ['simple', 'advanced', 'professional'] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

export interface StageBlueprint {
  systemPrompt: string;
  customInstructions: string;
  handoverPrompt: string;
  definitionOfDone: string;
  model: 'haiku' | 'sonnet' | 'opus';
  effort: 'low' | 'medium' | 'high';
}
export interface PresetSummary { preset: PresetKey; stages: { key: string; name: string; kind: string; aiEnabled: boolean }[] }
export interface PipelinePresetData {
  presets: PresetSummary[];
  byKind: Record<string, StageBlueprint>;
  byKey: Record<string, StageBlueprint>;
}

const EMPTY: PipelinePresetData = { presets: [], byKind: {}, byKey: {} };

export function isPresetKey(v: string): v is PresetKey {
  return v === 'simple' || v === 'advanced' || v === 'professional';
}

/** The framework's own pipeline defaults. Read once per workspace; a failure yields the empty shape,
 *  which simply hides the preset menu rather than showing a broken one. */
export function usePipelinePresets(workspaceId: string): PipelinePresetData {
  const [data, setData] = useState<PipelinePresetData>(EMPTY);
  //? Sequence guard, same reason as the repo-introspection read: switching workspace overlaps requests
  //? and a slow first response must never overwrite a newer one.
  const runRef = useRef(0);

  useEffect(() => {
    runRef.current += 1;
    const run = runRef.current;
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/pipelinePresets', version: 'v1', data: { workspaceId } }));
      if (runRef.current !== run) return;
      setData(error || res?.status !== 'success' ? EMPTY : res.result);
    })();
  }, [workspaceId]);

  return data;
}

/** The blueprint behind a stage: its seeded key first (so Refined restores Refined's own text), then its
 *  kind (so a hand-added stage still gets something real). `undefined` when neither exists. */
export function blueprintFor(data: PipelinePresetData, stage: Pick<PipelineStageCfg, 'id' | 'kind'>): StageBlueprint | undefined {
  return data.byKey[stage.id] ?? data.byKind[stage.kind];
}

/** Which preset this project's pipeline currently IS — derived from the stages that exist, not read
 *  from `Workspace.presetKey`. That field records the tier the WORKSPACE was created with; it is not
 *  per project, it is not updated by a switch, and it does not reach the client snapshot at all. A
 *  checkmark sourced from it would be wrong roughly as often as it was right. `undefined` = the stages
 *  match no preset, which is a real and fine state (you added or removed one), and reads as "custom". */
export function currentPreset(data: PipelinePresetData, stages: PipelineStageCfg[]): PresetKey | undefined {
  const owned = new Set(data.presets.flatMap((p) => p.stages.map((s) => s.key)));
  const mine = new Set(stages.map((s) => s.id).filter((k) => owned.has(k)));
  return data.presets.find((p) => p.stages.length === mine.size && p.stages.every((s) => mine.has(s.key)))?.preset;
}

/** How many of this stage's prompt fields are empty AND have a default to fill them with.
 *
 *  Counting every empty field was wrong in the way that matters: `unrefined` and `final` ship blank BY
 *  DESIGN (AI off), so a fully configured pipeline still read "Fill 8 empty fields from the defaults",
 *  the count could never reach 0, `disabled: blanks === 0` was unreachable, and confirming the action
 *  round-tripped a control-op that wrote nothing. A field with no default is not a gap. */
export function emptyPromptFields(stage: PipelineStageCfg, data: PipelinePresetData): number {
  const bp = blueprintFor(data, stage);
  if (bp === undefined) return 0;
  const pairs: [string, string][] = [
    [stage.systemPrompt ?? '', bp.systemPrompt],
    [stage.customInstructions, bp.customInstructions],
    [stage.handoverPrompt, bp.handoverPrompt],
    [stage.definitionOfDone ?? '', bp.definitionOfDone],
  ];
  return pairs.filter(([value, fallback]) => value.trim().length === 0 && fallback.trim().length > 0).length;
}

/** The pipeline menu: fill the blanks, or switch tier. Renders nothing until the defaults have loaded. */
export function PresetMenu({ data, stages, tickets }: { data: PipelinePresetData; stages: PipelineStageCfg[]; tickets: { stageId: string }[] }) {
  const translate = useTranslator();
  const { activeProjectId, stageConfigs, applyPipelinePreset } = useWorkspaces();
  if (data.presets.length === 0 || !activeProjectId) return null;

  const current = currentPreset(data, stages);
  //? The Conductor fills persisted rows, not this page's unsaved draft. Count the same snapshot rows
  //? that the write will inspect so the confirmation cannot promise a different number.
  const blanks = stageConfigs.reduce((n, s) => n + emptyPromptFields(s, data), 0);

  const fill = (): void => {
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.pipeline.presetFillTitle' }),
      content: translate({ key: 'workspaces.pipeline.presetFillBody', params: [{ key: 'count', value: String(blanks) }] }),
      //? `fill` resolves each stage's blueprint from the stage itself, so the preset argument only has
      //? to be valid — it does not choose what gets written.
    }).then((ok) => { if (ok) applyPipelinePreset(activeProjectId, current ?? 'professional', 'fill'); });
  };

  const switchTo = (preset: PresetKey): void => {
    const target = data.presets.find((p) => p.preset === preset);
    if (!target) return;
    const wantedKeys = new Set(target.stages.map((s) => s.key));
    //? Only the stages the DEFAULT pipeline owns are structural — a stage the user added themselves is
    //? never dropped, so it must not appear in the warning either (the server applies the same rule).
    const ownedKeys = new Set(data.presets.flatMap((p) => p.stages.map((s) => s.key)));
    const dropped = stages.filter((s) => ownedKeys.has(s.id) && !wantedKeys.has(s.id));
    const droppedKeys = new Set(dropped.map((s) => s.id));
    const moving = tickets.filter((t) => droppedKeys.has(t.stageId)).length;
    const added = target.stages.filter((s) => !stages.some((st) => st.id === s.key));

    const lines = [
      added.length > 0 ? translate({ key: 'workspaces.pipeline.presetSwitchAdds', params: [{ key: 'names', value: added.map((s) => s.name).join(', ') }] }) : '',
      dropped.length > 0 ? translate({ key: 'workspaces.pipeline.presetSwitchRemoves', params: [{ key: 'names', value: dropped.map((s) => s.name).join(', ') }] }) : '',
      moving > 0 ? translate({ key: 'workspaces.pipeline.presetSwitchMoves', params: [{ key: 'count', value: String(moving) }] }) : '',
      translate({ key: 'workspaces.pipeline.presetSwitchKeepsCustom' }),
    ].filter((line) => line.length > 0);

    void menuHandler.confirm({
      title: translate({ key: 'workspaces.pipeline.presetSwitchTitle', params: [{ key: 'preset', value: translate({ key: `workspaces.modules.tier_${preset}` }) }] }),
      content: lines.join('\n\n'),
    }).then((ok) => { if (ok) applyPipelinePreset(activeProjectId, preset, 'switch'); });
  };

  const items: PopMenuItem[] = [
    { label: translate({ key: 'workspaces.pipeline.presetFill', params: [{ key: 'count', value: String(blanks) }] }), icon: 'wand-magic-sparkles', onClick: fill, disabled: blanks === 0 },
    { divider: true },
    ...data.presets.map((p): PopMenuItem => ({
      label: translate({ key: `workspaces.modules.tier_${p.preset}` }),
      icon: p.preset === current ? 'check' : 'diagram-project',
      onClick: () => { if (p.preset !== current) switchTo(p.preset); },
      disabled: p.preset === current,
    })),
  ];

  return <PopMenu label={translate({ key: 'workspaces.pipeline.presetMenu' })} items={items} />;
}
