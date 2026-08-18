//? intent: the project's AI pipeline — the ordered stages every ticket flows through, each stage run
//? by its own AI in its own container. Pick a stage in the flow strip, tune how its AI behaves and
//? hit "Save stage" (General / Context / Model for everyone; the seven dev/ops tabs live behind the
//? admin-only Advanced menu). A second in-page tab holds the Automations (WorkspaceTriggers) that
//? react to pipeline events. Mirrors the genormaliseerd PipelineStage model + child collections and
//? the rendered claudeSettings — see handoff/DATAMODEL.md §2 + CLAUDE_SETTINGS_MAP.md.

import { useEffect, useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { AnimatePresence, motion } from 'motion/react';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import { EmptyState, PopMenu, Tabs, Toggle, WsButton, type TabDef } from '../../_components/primitives';
import { useTrailSegment } from '../../_components/sections';
import { HOOK_CATALOG } from '../../_data/seed';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { CarryoverTab, CommandsTab, ContextTab, GeneralTab, HooksTab, IntegrationsTab, ModelTab, NetworkTab, ProcessTab, VisibilityTab } from './stageTabs';
import type { PipelineStageCfg, StageWarning } from '../../_data/types';

function blankStage(projectId: string, id: string, name: string, order: number): PipelineStageCfg {
  return {
    projectId,
    id, kind: 'code', name, order, aiEnabled: true, customInstructions: '', promptTemplate: '',
    skillKeys: [], sourceIds: [], commands: [], tools: [],
    statuses: [
      { key: 'needs-input', label: 'Needs input', kind: 'base' }, { key: 'busy', label: 'Busy', kind: 'base' },
      { key: 'stopped', label: 'Stopped', kind: 'base' }, { key: 'done', label: 'Done', kind: 'base' },
    ],
    processes: [], visibleStageIds: [],
    modelCfg: { autoEscalate: false, base: { model: 'sonnet', effort: 'medium', maxTurns: 12 }, rules: [] },
    network: { enabled: true, mode: 'whitelist', categories: ['package-registries', 'source-hosts'], domains: [] },
    hooks: Object.fromEntries(HOOK_CATALOG.map((h) => [h.key, true] as const)),
  };
}

/* ----------------------------------------------------------------- main */
export const template = 'workspaces';

//? Every tab id, basic + advanced, in one list: the URL segment is validated against ALL of them so a
//? deep link to an advanced tab resolves (the tab bar then surfaces it), while an unknown segment
//? still falls back to General instead of rendering an empty panel.
const STAGE_TAB_IDS = ['general', 'context', 'model', 'commands', 'integrations', 'visibility', 'process', 'carryover', 'network', 'hooks'];

export default function Pipeline() {
  const translate = useTranslator();
  const { activeWorkspace, activeProjectId, stageConfigs, saveStageConfig, createStage, deleteStage, reorderStages, navigate } = useWorkspaces();
  const [stages, setStages] = useState<PipelineStageCfg[]>(stageConfigs);
  //? ADR 0312 — the selected stage and its tab are the URL
  //? (`/workspaces/develop/pipeline/<stageId>/context`), so a stage is linkable and the "open this
  //? stage" deep-link from Sources actually lands on it. It used to navigate to the page and select
  //? nothing, because the focus request had no consumer here.
  const [selectedId, setSelectedId] = useTrailSegment(0, stages.map((st) => st.id), stageConfigs[0]?.id ?? '');
  const [tab, setTab] = useTrailSegment(1, STAGE_TAB_IDS, 'general');

  const [warnings, setWarnings] = useState<StageWarning[]>([]);

  //? Re-seed the editable copy whenever the live snapshot loads/changes (initial
  //? load + after a save round-trips through the Conductor + refetch).
  //? The stale-selection guard that used to live here is now inherent: the selection is read from the
  //? URL and validated against the stages that exist, so a deleted stage falls back on its own.
  useEffect(() => { setStages(stageConfigs); }, [stageConfigs]);

  const s = stages.find((x) => x.id === selectedId) ?? stages[0];
  const update = (patch: Partial<PipelineStageCfg>) => { setStages((p) => p.map((st) => (st.id === selectedId ? { ...st, ...patch } : st))); };
  const save = () => { if (s) saveStageConfig(s); };

  const move = (dir: -1 | 1) => { setStages((p) => {
    const i = p.findIndex((x) => x.id === selectedId);
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const copy = [...p];
    const a = copy[i];
    const b = copy[j];
    if (!a || !b) return p;
    copy[i] = b;
    copy[j] = a;
    const reordered = copy.map((st, idx) => ({ ...st, order: idx }));
    //? R1 — persist the new order (stage ids in sequence) so a reorder survives a refresh.
    if (activeProjectId) reorderStages(activeProjectId, reordered.map((st) => st.id));
    return reordered;
  }); };

  const addStage = () => {
    if (!activeProjectId) return;
    const key = `stage-${String(stages.length)}-${String(Date.now())}`;
    const name = `Stage ${String(stages.length + 1)}`;
    setStages((p) => [...p, blankStage(activeProjectId, key, name, p.length)]);
    setSelectedId(key);
    setTab('general');
    //? R1 — persist the new stage immediately (was React-state-only → lost on refresh).
    createStage({ projectId: activeProjectId, key, name, kind: 'code' });
  };

  const removeStage = () => void menuHandler.confirm({ title: translate({ key: 'workspaces.pipeline.deleteStageConfirmTitle', params: [{ key: 'name', value: s?.name ?? '' }] }), content: translate({ key: 'workspaces.pipeline.deleteStageConfirmContent' }) }).then((ok) => {
    if (!ok) return;
    const fallback = stages.find((x) => x.id !== selectedId)?.id ?? '';
    const removed = selectedId;
    setStages((p) => p.filter((x) => x.id !== selectedId).map((st, idx) => ({ ...st, order: idx })));
    setSelectedId(fallback);
    //? R1 — persist the deletion.
    if (removed && activeProjectId) deleteStage(activeProjectId, removed);
  });

  const validate = () => {
    const w: StageWarning[] = [];
    for (const st of stages) {
      if (st.aiEnabled && st.skillKeys.length === 0 && st.order !== 0 && st.order !== stages.length - 1)
        w.push({ stageId: st.id, severity: 'info', text: translate({ key: 'workspaces.pipeline.warnBlind', params: [{ key: 'name', value: st.name }] }) });
      if (st.aiEnabled && !st.customInstructions.trim())
        w.push({ stageId: st.id, severity: 'info', text: translate({ key: 'workspaces.pipeline.warnNoInstructions', params: [{ key: 'name', value: st.name }] }) });
      if (st.tools.some((t) => t.tier === 'rw') && st.id !== 'impl')
        w.push({ stageId: st.id, severity: 'warn', text: translate({ key: 'workspaces.pipeline.warnWriteAccess', params: [{ key: 'name', value: st.name }] }) });
      if (st.aiEnabled && !st.network.enabled && st.skillKeys.length > 0)
        w.push({ stageId: st.id, severity: 'info', text: translate({ key: 'workspaces.pipeline.warnNetworkOff', params: [{ key: 'name', value: st.name }] }) });
    }
    const refined = stages.find((x) => x.id === 'refined');
    const plan = stages.find((x) => x.id === 'plan');
    if (refined?.skillKeys.includes('rag') && plan && !plan.skillKeys.includes('rag'))
      w.push({ stageId: 'plan', severity: 'warn', text: translate({ key: 'workspaces.pipeline.warnRagMismatch' }) });
    setWarnings(w);
  };

  const warnFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of warnings) m.set(w.stageId, (m.get(w.stageId) ?? 0) + 1);
    return m;
  }, [warnings]);

  //? KISS — the day-to-day stage knobs are General / Context / Model, always visible. The seven dev/ops
  //? tabs (commands, integrations, visibility, process, carryover, network egress, lifecycle hooks) sit
  //? behind ONE "Advanced" menu, role-gated to admin/owner (fail-open: unresolved role ≠ 'member'). When
  //? an advanced tab is active it appears as a fourth tab so you can see where you are.
  const showAdvanced = activeWorkspace.role !== 'member';
  const basicTabs: TabDef[] = [
    { id: 'general', label: translate({ key: 'workspaces.pipeline.tabGeneral' }), icon: 'sliders' },
    { id: 'context', label: translate({ key: 'workspaces.pipeline.tabContext' }), icon: 'book-open' },
    { id: 'model', label: translate({ key: 'workspaces.pipeline.tabModel' }), icon: 'bolt' },
  ];
  const advancedTabs: TabDef[] = [
    { id: 'commands', label: translate({ key: 'workspaces.pipeline.tabCommands' }), icon: 'terminal' },
    { id: 'integrations', label: translate({ key: 'workspaces.pipeline.integrations' }), icon: 'database' },
    { id: 'visibility', label: translate({ key: 'workspaces.pipeline.tabVisibility' }), icon: 'eye' },
    { id: 'process', label: translate({ key: 'workspaces.pipeline.tabProcess' }), icon: 'play' },
    { id: 'carryover', label: translate({ key: 'workspaces.pipeline.tabCarryover' }), icon: 'code-merge' },
    { id: 'network', label: translate({ key: 'workspaces.pipeline.tabNetwork' }), icon: 'shield-halved' },
    { id: 'hooks', label: translate({ key: 'workspaces.pipeline.tabHooks' }), icon: 'link' },
  ];
  const activeAdvanced = showAdvanced ? advancedTabs.find((t) => t.id === tab) : undefined;
  const visibleTabs = activeAdvanced ? [...basicTabs, activeAdvanced] : basicTabs;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header — ONE primary action (Add stage); Validate is a secondary, non-primary action */}
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.pipeline.pipelineTitle' })}</h1>
          <span className="text-sm text-muted">{translate({ key: 'workspaces.pipeline.headerSummary', params: [{ key: 'name', value: activeWorkspace.name }, { key: 'count', value: String(stages.length) }] })}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* collapses to its icon on phones; label returns from sm: up */}
          <WsButton variant="ghost" icon="wand-magic-sparkles" onClick={validate} title={translate({ key: 'workspaces.pipeline.validateWithAi' })}>
            <span className="hidden sm:inline">{translate({ key: 'workspaces.pipeline.validateWithAi' })}</span>
          </WsButton>
          <WsButton icon="plus" onClick={addStage}>{translate({ key: 'workspaces.pipeline.addStage' })}</WsButton>
        </div>
      </div>

      {/* Automations moved to their own destination (develop/automations). A one-tap cross-link sits
          where the in-page Automations tab used to be, so the pipeline stays stage-editor focused. */}
      <div className="px-4 md:px-6 shrink-0">
        <button
          type="button" onClick={() => { navigate('automations'); }}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:text-common hover:bg-container2 cursor-pointer transition-colors"
        >
          <Icon name="bolt" className="text-primary" /> {translate({ key: 'workspaces.pipeline.automationsMoved' })} <Icon name="arrow-right-long" className="text-xs" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8 pt-4 flex flex-col gap-4">
        {(stages.length === 0 || !s) && (
          //? Teaching empty state — explains what the pipeline IS and offers the first action.
          <div className="rounded-2xl border border-container1-border bg-container1">
            <EmptyState
              icon="diagram-project"
              title={translate({ key: 'workspaces.pipeline.emptyTitle' })}
              sub={translate({ key: 'workspaces.pipeline.emptyBody' })}
              action={<WsButton icon="plus" onClick={addStage}>{translate({ key: 'workspaces.pipeline.addStage' })}</WsButton>}
            />
          </div>
        )}

        {s && (
          <>
            {/* flow strip — the pipeline itself; tap a stage to edit it */}
            <div className="flex items-center gap-1 overflow-x-auto ws-no-scrollbar pb-1 shrink-0">
              {stages.map((st, i) => {
                const active = st.id === selectedId;
                const warns = warnFor.get(st.id) ?? 0;
                return (
                  <div key={st.id} className="flex items-center gap-1 shrink-0">
                    <button
                      type="button" onClick={() => { setSelectedId(st.id); }}
                      className={`relative flex items-center gap-2 rounded-xl border px-3 h-11 cursor-pointer transition-colors ${active ? 'border-primary bg-primary/10' : (st.aiEnabled ? 'border-container1-border bg-container1 hover:bg-container1-hover' : 'border-container1-border bg-container2/40 hover:bg-container2')}`}
                    >
                      <span className={`w-5 h-5 shrink-0 rounded-md text-[11px] font-bold flex items-center justify-center ${active ? 'bg-primary text-title-primary' : 'bg-container2 text-muted'}`}>{i + 1}</span>
                      <span className="text-sm font-medium text-title whitespace-nowrap">{st.name}</span>
                      <Icon name={st.aiEnabled ? 'robot' : 'ban'} className={`text-xs ${st.aiEnabled ? 'text-primary' : 'text-muted'}`} />
                      {warns > 0 && <span className="w-1.5 h-1.5 rounded-full bg-warning" title={translate({ key: 'workspaces.pipeline.findingsCount', params: [{ key: 'count', value: String(warns) }] })} />}
                    </button>
                    {i < stages.length - 1 && <Icon name="angle-right" className="text-muted text-xs shrink-0" />}
                  </div>
                );
              })}
            </div>

            {/* validation findings */}
            <AnimatePresence initial={false}>
              {warnings.length > 0 && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden shrink-0">
                  <div className="flex flex-col gap-2">
                    {warnings.map((w, i) => (
                      <div key={`${w.stageId}-${w.text}`} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${w.severity === 'warn' ? 'border-warning/40 bg-warning/10' : 'border-container1-border bg-container2/40'}`}>
                        <Icon name={w.severity === 'warn' ? 'triangle-exclamation' : 'circle-question'} className={`mt-0.5 shrink-0 ${w.severity === 'warn' ? 'text-warning' : 'text-muted'}`} />
                        <span className="flex-1 text-sm text-common">{w.text}</span>
                        <button type="button" onClick={() => { setSelectedId(w.stageId); }} className="text-xs text-primary hover:underline cursor-pointer shrink-0">{translate({ key: 'workspaces.pipeline.goToStage' })}</button>
                        <button type="button" onClick={() => { setWarnings((p) => p.filter((_, j) => j !== i)); }} className="text-muted hover:text-title cursor-pointer shrink-0"><Icon name="xmark" className="text-xs" /></button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* selected stage — name + AI toggle + the ONE persist action (Save stage); rarer
                stage actions (reorder, delete) live in the kebab. flex-wrap keeps it usable on phones. */}
            <div className="rounded-2xl border border-container1-border bg-container1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-5 py-3 border-b border-divider">
                <input value={s.name} onChange={(e) => { update({ name: e.target.value }); }} className="text-base font-semibold text-title bg-transparent focus:outline-none border-b border-transparent focus:border-primary min-w-0 flex-1 basis-44" />
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  <Toggle on={s.aiEnabled} onChange={(v) => { update({ aiEnabled: v }); }} label={s.aiEnabled ? translate({ key: 'workspaces.pipeline.aiOn' }) : translate({ key: 'workspaces.pipeline.noAi' })} />
                  <WsButton icon="check" onClick={save}>{translate({ key: 'workspaces.pipeline.saveStage' })}</WsButton>
                  <PopMenu
                    ariaLabel={translate({ key: 'workspaces.pipeline.stageActions' })}
                    items={[
                      { label: translate({ key: 'workspaces.pipeline.moveEarlier' }), icon: 'angle-left', onClick: () => { move(-1); } },
                      { label: translate({ key: 'workspaces.pipeline.moveLater' }), icon: 'angle-right', onClick: () => { move(1); } },
                      { divider: true },
                      { label: translate({ key: 'workspaces.pipeline.deleteStage' }), icon: 'trash', danger: true, onClick: removeStage },
                    ]}
                  />
                </div>
              </div>

              <div className="px-4 md:px-5 pt-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Tabs tabs={visibleTabs} active={tab} onChange={setTab} />
                </div>
                {showAdvanced && (
                  <PopMenu
                    label={translate({ key: 'workspaces.pipeline.advanced' })}
                    items={advancedTabs.map((t) => ({ label: t.label, icon: t.icon, onClick: () => { setTab(t.id); } }))}
                  />
                )}
              </div>

              <div className="p-4 md:p-5">
                {tab === 'general' && <GeneralTab s={s} update={update} />}
                {tab === 'context' && <ContextTab s={s} update={update} />}
                {tab === 'commands' && <CommandsTab s={s} update={update} />}
                {tab === 'integrations' && <IntegrationsTab s={s} update={update} />}
                {tab === 'visibility' && <VisibilityTab s={s} update={update} stages={stages} />}
                {tab === 'process' && <ProcessTab s={s} update={update} />}
                {tab === 'carryover' && <CarryoverTab s={s} update={update} />}
                {tab === 'model' && <ModelTab s={s} update={update} />}
                {tab === 'network' && <NetworkTab s={s} update={update} />}
                {tab === 'hooks' && <HooksTab s={s} update={update} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
