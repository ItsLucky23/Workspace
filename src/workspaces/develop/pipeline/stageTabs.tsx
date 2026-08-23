//? Pipeline — the per-stage config tabs (extracted from page.tsx for the KISS redesign).
//? General / Context / Model are the everyone-tabs; Commands, Integrations, Visibility, Process,
//? Carry-over, Network and Hooks are the admin/owner "Advanced" set the page reveals via its
//? Advanced menu. Every input mutates the page's LOCAL stage copy via `update`; nothing here
//? persists — "Save stage" on the page is the only persist path (saveStageConfig).

import { useMemo, useState, type ReactNode } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { EffectivePromptPreview, LayerNote, LayerTip } from '../../_components/EffectivePromptPreview';
import { Collapse } from '../../_components/motion';
import { Disclosure, IconButton, InfoDot, InfoTip, Segmented, Toggle, WsButton } from '../../_components/primitives';
import { INPUT_CLS as inputCls } from '../../_components/settings';
import { EmptyPicker } from '../../_components/SetupNotice';
import { resolveAiLayers } from '../../_functions/aiLayers';
import { COMMAND_CATALOG, HOOK_CATALOG, NETWORK_CATEGORIES } from '../../_data/catalogs';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { StageBlueprint } from './presets';
import type { CommandMode, NetworkMode, PipelineStageCfg, StageEffort, StageModelChoice, StageModelTier, ToolTier } from '../../_data/types';

//? `bp` is the canonical starting content for this stage (its seeded key, else its kind) as served by
//? `workspaces/pipelinePresets/v1`. It is what the "use the default" affordance writes into an empty
//? field — undefined while the read is in flight, or for a kind with no default (a `final` stage).
export interface TabProps { s: PipelineStageCfg; update: (patch: Partial<PipelineStageCfg>) => void; bp?: StageBlueprint }

const MODE_TINT: Record<CommandMode, string> = { allow: 'bg-correct/15 text-correct', ask: 'bg-warning/15 text-warning', deny: 'bg-wrong/15 text-wrong' };

const areaCls = 'w-full px-3 py-2 rounded-lg border border-container1-border bg-container2/50 text-sm text-title font-mono leading-relaxed focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

/** The first line of a skill's text — enough to recognise it in a picker without opening it. */
const firstLine = (text: string): string => text.split(/\r?\n/)[0] ?? '';

//? Toggle a key's presence in a string array (used by the context + visibility tabs).
const toggleKey = (arr: string[], key: string): string[] => (arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]);

//? The carry-over schema each stage must emit — a code sample, not translatable UI copy.
const EMIT_SCHEMA_SAMPLE = `{
  "summary": "string",
  "changedFiles": ["path", …],
  "openQuestions": ["string", …],
  "commitHash": "string"
}`;

//? An empty field with a known default is the complaint this answers: the pipeline LOOKS configured
//? while its agent runs on nothing, and the default that would have been there sits in the server's
//? seed and is unreachable. Offered, never applied silently — it writes into the editor, and "Save
//? stage" is still the only persist path.
function UseDefault({ value, fallback, onUse }: { value: string; fallback: string | undefined; onUse: (text: string) => void }) {
  const translate = useTranslator();
  if (value.trim().length > 0 || fallback === undefined || fallback.length === 0) return null;
  return (
    <button
      type="button" onClick={() => { onUse(fallback); }}
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10 cursor-pointer transition-colors`}
    >
      <Icon name="wand-magic-sparkles" className={`text-[10px]`} /> {translate({ key: 'workspaces.pipeline.useDefault' })}
    </button>
  );
}

//? `note` carries the inheritance line for a layered field (ADR 0308): a stage prompt states its
//? position in the chain right where it is edited, instead of the old hint copy that said
//? "layered above your instructions" without ever naming what it layers above.
function FieldLabel({ title, hint, note, info }: { title: string; hint?: string; note?: ReactNode; info?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <div className={`flex items-center gap-1.5`}>
        <span className="text-sm font-semibold text-title">{title}</span>
        {info}
      </div>
      {hint && <div className="text-xs text-muted mt-0.5">{hint}</div>}
      {note && (
        <div className="inline-flex items-center gap-1.5 mt-1.5 rounded-md bg-container2 px-1.5 py-0.5 text-[11px] text-meta">
          <Icon name="layer-group" className="text-[10px]" />
          {note}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- General */
export function GeneralTab({ s, update, bp }: TabProps) {
  const translate = useTranslator();
  const { activeWorkspace, aiSkills } = useWorkspaces();
  //? ADR 0308 — all five layers resolved for THIS stage, so the preview below shows the real
  //? composed prompt (workspace + skills + this stage's three fields) rather than the stage half.
  const layers = resolveAiLayers({ workspace: activeWorkspace, skills: aiSkills, stage: s });
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div>
        <FieldLabel
          title={translate({ key: 'workspaces.pipeline.systemPrompt' })}
          hint={translate({ key: 'workspaces.pipeline.systemPromptHint' })}
          note={<LayerNote layers={layers} id="stageSystemPrompt" />}
          info={<><LayerTip layers={layers} id="stageSystemPrompt" stageId={s.id} /><UseDefault value={s.systemPrompt ?? ''} fallback={bp?.systemPrompt} onUse={(text) => { update({ systemPrompt: text }); }} /></>}
        />
        <textarea rows={3} value={s.systemPrompt ?? ''} onChange={(e) => { update({ systemPrompt: e.target.value }); }} className={areaCls} placeholder={translate({ key: 'workspaces.pipeline.systemPromptPlaceholder' })} />
      </div>
      <div>
        <FieldLabel
          title={translate({ key: 'workspaces.pipeline.customInstructions' })}
          hint={translate({ key: 'workspaces.pipeline.customInstructionsHint' })}
          note={<LayerNote layers={layers} id="stageInstructions" />}
          info={<><LayerTip layers={layers} id="stageInstructions" stageId={s.id} /><UseDefault value={s.customInstructions} fallback={bp?.customInstructions} onUse={(text) => { update({ customInstructions: text }); }} /></>}
        />
        <textarea rows={4} value={s.customInstructions} onChange={(e) => { update({ customInstructions: e.target.value }); }} className={areaCls} placeholder={translate({ key: 'workspaces.pipeline.customInstructionsPlaceholder' })} />
      </div>
      {/* secondary + optional relative to system prompt/custom instructions above — a disclosure
          instead of a fourth identical textarea block gives it its own visual weight; starts open
          when a stage already has one set, so nothing already configured looks hidden. */}
      <Disclosure summary={translate({ key: 'workspaces.pipeline.definitionOfDone' })} defaultOpen={Boolean(s.definitionOfDone)}>
        <div className="text-xs text-muted -mt-1 mb-2 flex items-center gap-2 flex-wrap">
          {translate({ key: 'workspaces.pipeline.definitionOfDoneHint' })}
          <UseDefault value={s.definitionOfDone ?? ''} fallback={bp?.definitionOfDone} onUse={(text) => { update({ definitionOfDone: text }); }} />
        </div>
        <textarea rows={2} value={s.definitionOfDone ?? ''} onChange={(e) => { update({ definitionOfDone: e.target.value }); }} className={areaCls} placeholder={translate({ key: 'workspaces.pipeline.definitionOfDonePlaceholder' })} />
      </Disclosure>
      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.statuses' })} hint={translate({ key: 'workspaces.pipeline.statusesHint' })} />
        <div className="flex flex-wrap items-center gap-2">
          {s.statuses.filter((st) => st.kind === 'base').map((st) => (
            <span key={st.key} className="inline-flex items-center gap-1.5 rounded-full bg-container2 px-2.5 py-1 text-xs font-medium text-common">
              {st.label}
            </span>
          ))}
        </div>
      </div>

      {/* The full composed text, at the BOTTOM and collapsed. It used to sit on top of the very fields
          it describes, which is what made the page feel crowded — and it answers a different question
          than the "?" beside each field: not "where does this come from" but "what does the agent
          literally receive". A debugging view, opened when you want it. */}
      <EffectivePromptPreview layers={layers} stageId={s.id} inlineIds={['stageSystemPrompt', 'stageInstructions']} />
    </div>
  );
}

/* ----------------------------------------------------------------- Context & Skills */
export function ContextTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const { docs, skills, aiSkills, focusSetup } = useWorkspaces();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <FieldLabel
          title={translate({ key: 'workspaces.pipeline.contextDocs' })}
          hint={translate({ key: 'workspaces.pipeline.contextDocsHint' })}
          info={<InfoTip align="start" title={translate({ key: 'workspaces.tips.pipeline.contextDocsTitle' })} body={translate({ key: 'workspaces.tips.pipeline.contextDocsBody' })} />}
        />
        <div className="flex flex-col gap-1.5">
          {docs.length === 0 && (
            <EmptyPicker
              icon="file-lines"
              label={translate({ key: 'workspaces.tips.pipeline.noDocs' })}
              fix={{ cap: 'editPipeline', view: 'sources', tab: 'docs', cta: translate({ key: 'workspaces.tips.pipeline.noDocsCta' }) }}
            />
          )}
          {docs.map((d) => {
            const on = s.sourceIds.includes(d.id);
            return (
              <button key={d.id} type="button" onClick={() => { update({ sourceIds: toggleKey(s.sourceIds, d.id) }); }} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left cursor-pointer transition-colors ${on ? 'border-primary/40 bg-primary/5' : 'border-container1-border hover:bg-container2/40'}`}>
                <Icon name="file-lines" className={on ? 'text-primary' : 'text-muted'} />
                <div className="min-w-0 flex-1"><div className="text-sm text-title truncate">{d.name}</div><div className="text-xs text-muted line-clamp-2">{d.summary}</div></div>
                <Icon name={on ? 'circle-check' : 'plus'} className={`text-xs shrink-0 ${on ? 'text-primary' : 'text-muted'}`} />
              </button>
            );
          })}
        </div>
      </div>
      {/* Owner decision 2026-08-20 — a skill is switched on HERE, per stage, not globally on the AI
          page. A plan stage and a review stage want different instructions, and a single workspace
          toggle could not say so; worse, a skill could be "on" and still do nothing because its apply
          points excluded the run you were looking at. The stage picks; the stage runner sends exactly
          these to its agent. */}
      <div>
        <FieldLabel
          title={translate({ key: 'workspaces.pipeline.aiSkills' })}
          hint={translate({ key: 'workspaces.pipeline.aiSkillsHint' })}
          info={<InfoTip align="start" title={translate({ key: 'workspaces.pipeline.aiSkillsTipTitle' })} body={translate({ key: 'workspaces.pipeline.aiSkillsTipBody' })} />}
        />
        <div className="flex flex-col gap-1.5">
          {aiSkills.length === 0 && (
            <EmptyPicker
              icon="wand-magic-sparkles"
              label={translate({ key: 'workspaces.pipeline.noAiSkills' })}
              fix={{ cap: 'workspaceSettings', view: 'workspace', tab: 'aibehavior', section: 'skills', cta: translate({ key: 'workspaces.pipeline.manageAiSkills' }) }}
            />
          )}
          {aiSkills.map((sk) => {
            const on = s.aiSkillIds.includes(sk.id);
            return (
              <button
                key={sk.id} type="button" role="switch" aria-checked={on}
                onClick={() => { update({ aiSkillIds: toggleKey(s.aiSkillIds, sk.id) }); }}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2 text-left cursor-pointer transition-colors ${on ? 'border-primary/40 bg-primary/5' : 'border-container1-border hover:bg-container2/40'}`}
              >
                <Icon name={on ? 'circle-check' : 'wand-magic-sparkles'} className={`mt-0.5 shrink-0 ${on ? 'text-primary' : 'text-muted'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-title truncate">{sk.name}</span>
                  <span className="block text-xs text-muted line-clamp-2">{firstLine(sk.instruction)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.skillsMcp' })} hint={translate({ key: 'workspaces.pipeline.skillsMcpHint' })} />
        <div className="flex flex-col gap-1.5">
          {/* Verified before touching this copy, because the obvious "rewrite" was wrong: a capability
              skill (`Skill.skillType === 'capability'`) is created in exactly two places in the whole
              repo — the DEMO seed and a legacy-data migration. `ai-skill-save` only ever writes
              `'instruction'`, and `scan-index` writes RagEntry rows, not skills. So "nothing in the app
              creates one, and reindexing will not fill this list" is TRUE and stays.
              What was missing is the other half: the OTHER thing called Skills — written instruction
              blocks — has a full create/edit surface in workspace settings, and a user reading the word
              "skills" here has no way to know that. The name collision is the actual confusion, so both
              are named. Deliberately NO index-scan button: it would not add a single row. */}
          {skills.length === 0 && (
            <EmptyPicker
              icon="robot"
              label={(
                <span className={`flex flex-col gap-1`}>
                  <span>{translate({ key: 'workspaces.tips.pipeline.noSkills' })}</span>
                  <span className={`text-xs text-meta`}>
                    {translate({ key: 'workspaces.tips.pipeline.noSkillsAlt' })}{' '}
                    <button
                      type="button" onClick={() => { focusSetup({ view: 'workspace', tab: 'aibehavior' }); }}
                      className={`text-primary hover:underline cursor-pointer`}
                    >
                      {translate({ key: 'workspaces.tips.pipeline.noSkillsAltCta' })}
                    </button>
                  </span>
                </span>
              )}
            />
          )}
          {skills.map((sk) => {
            const on = s.skillKeys.includes(sk.id);
            return (
              <div key={sk.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${on ? 'border-primary/40 bg-primary/5' : 'border-container1-border'}`}>
                <Icon name={sk.kind === 'frozen' ? 'database' : 'bolt'} className={`mt-0.5 ${on ? 'text-primary' : 'text-muted'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-title truncate">{sk.name}</span>
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${sk.kind === 'frozen' ? 'bg-secondary/12 text-secondary' : 'bg-correct/15 text-correct'}`}>{sk.kind}</span>
                  </div>
                  <div className="text-xs text-muted line-clamp-2 mt-0.5">{sk.description ?? sk.status}</div>
                </div>
                <Toggle on={on} onChange={() => { update({ skillKeys: toggleKey(s.skillKeys, sk.id) }); }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Commands */
function ModeSwitch({ value, onChange }: { value: CommandMode | null; onChange: (m: CommandMode | null) => void }) {
  const translate = useTranslator();
  const opts: [string, CommandMode | null][] = [[translate({ key: 'workspaces.pipeline.modeOff' }), null], [translate({ key: 'workspaces.pipeline.modeAllow' }), 'allow'], [translate({ key: 'workspaces.pipeline.modeAsk' }), 'ask'], [translate({ key: 'workspaces.pipeline.modeDeny' }), 'deny']];
  return (
    <div className="inline-flex rounded-lg bg-container2 p-0.5 shrink-0">
      {opts.map(([label, val]) => (
        <button key={label} type="button" onClick={() => { onChange(val); }} className={`rounded-md px-2 h-7 text-xs font-medium cursor-pointer transition-colors ${value === val ? (val ? MODE_TINT[val] : 'bg-container1 text-title shadow-sm') : 'text-muted hover:text-common'}`}>{label}</button>
      ))}
    </div>
  );
}

function CommandRow({ title, pattern, desc, mode, onMode, onDelete }: { title: string; pattern: string; desc?: string; mode: CommandMode | null; onMode: (m: CommandMode | null) => void; onDelete?: () => void }) {
  const translate = useTranslator();
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-title truncate">{title}</span>
          {desc && <InfoDot title={pattern} body={desc} align="left" />}
        </div>
        <div className="font-mono text-[11px] text-muted truncate">{pattern}</div>
      </div>
      <ModeSwitch value={mode} onChange={onMode} />
      {onDelete && <IconButton icon="trash" onClick={onDelete} size="md" title={translate({ key: 'workspaces.pipeline.removeCommand' })} className="shrink-0 hover:text-wrong" />}
    </div>
  );
}

function AddCommandForm({ categories, onAdd }: { categories: string[]; onAdd: (c: { category: string; title: string; desc: string; pattern: string }) => void }) {
  const translate = useTranslator();
  const [open, setOpen] = useState(false);
  const [catId, setCatId] = useState(categories[0] ?? 'Custom');
  const [newCat, setNewCat] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [pattern, setPattern] = useState('');
  const isNew = catId === '__new__';
  const items = [...categories.map((c) => ({ id: c, value: c, item: c })), { id: '__new__', value: '__new__', item: translate({ key: 'workspaces.pipeline.newCategoryOption' }) }];
  const submit = () => {
    const category = (isNew ? newCat : catId).trim();
    const t = title.trim(); const p = pattern.trim();
    if (!category || !t || !p) return;
    onAdd({ category, title: t, desc: desc.trim(), pattern: p });
    setTitle(''); setDesc(''); setPattern(''); setNewCat(''); setOpen(false);
  };
  return (
    <div className="flex flex-col gap-3">
      {!open && <WsButton variant="secondary" icon="plus" onClick={() => { setOpen(true); }} className="self-start">{translate({ key: 'workspaces.pipeline.addCommand' })}</WsButton>}
      <Collapse open={open}>
        <div className="rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.pipeline.category' })}</div>
              <Dropdown size="sm" width="full" value={items.find((i) => i.id === catId)} items={items} onChange={(it) => { setCatId(String(it.id)); }} />
            </div>
            {isNew && <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.pipeline.newCategory' })}</div><input value={newCat} onChange={(e) => { setNewCat(e.target.value); }} placeholder={translate({ key: 'workspaces.pipeline.newCategoryPlaceholder' })} className={`w-full ${inputCls}`} /></div>}
          </div>
          <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.pipeline.title' })}</div><input value={title} onChange={(e) => { setTitle(e.target.value); }} placeholder={translate({ key: 'workspaces.pipeline.titlePlaceholder' })} className={`w-full ${inputCls}`} /></div>
          <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.pipeline.description' })} <span className="text-muted/70">{translate({ key: 'workspaces.pipeline.optional' })}</span></div><input value={desc} onChange={(e) => { setDesc(e.target.value); }} placeholder={translate({ key: 'workspaces.pipeline.descriptionPlaceholder' })} className={`w-full ${inputCls}`} /></div>
          <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.pipeline.command' })}</div><input value={pattern} onChange={(e) => { setPattern(e.target.value); }} placeholder="Bash(npm run migrate)" className={`w-full font-mono ${inputCls}`} /></div>
          <div className="flex items-center gap-2">
            <WsButton icon="plus" onClick={submit}>{translate({ key: 'workspaces.pipeline.add' })}</WsButton>
            <WsButton variant="ghost" onClick={() => { setOpen(false); }}>{translate({ key: 'workspaces.pipeline.cancel' })}</WsButton>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

export function CommandsTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const catalogPatterns = useMemo(() => new Set(COMMAND_CATALOG.flatMap((g) => g.commands.map((c) => c.pattern))), []);
  const custom = s.commands.filter((c) => !catalogPatterns.has(c.pattern));
  const customCats = [...new Set(custom.map((c) => c.category ?? 'Custom'))];
  const formCategories = [...new Set([...COMMAND_CATALOG.map((g) => translate({ key: g.categoryKey })), ...customCats])];
  const modeOf = (pattern: string) => s.commands.find((c) => c.pattern === pattern)?.mode ?? null;
  const setMode = (pattern: string, mode: CommandMode | null) => {
    if (mode === null) { update({ commands: s.commands.filter((c) => c.pattern !== pattern) }); return; }
    const exists = s.commands.some((c) => c.pattern === pattern);
    update({ commands: exists ? s.commands.map((c) => (c.pattern === pattern ? { ...c, mode } : c)) : [...s.commands, { id: `cmd-${String(Date.now())}`, pattern, mode }] });
  };
  const addCustom = ({ category, title, desc, pattern }: { category: string; title: string; desc: string; pattern: string }) => {
    if (s.commands.some((c) => c.pattern === pattern)) return;
    update({ commands: [...s.commands, { id: `cmd-${String(Date.now())}`, pattern, mode: 'allow', title, desc, category }] });
  };

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <FieldLabel
        title={translate({ key: 'workspaces.pipeline.commandPermissions' })}
        hint={translate({ key: 'workspaces.pipeline.commandPermissionsHint' })}
        info={<InfoTip align="start" title={translate({ key: 'workspaces.tips.pipeline.commandsBaselineTitle' })} body={translate({ key: 'workspaces.tips.pipeline.commandsBaselineBody' })} />}
      />
      {COMMAND_CATALOG.map((group) => (
        <div key={group.categoryKey}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted mb-2">{translate({ key: group.categoryKey })}</div>
          <div className="flex flex-col gap-1.5">
            {group.commands.map((c) => <CommandRow key={c.pattern} title={translate({ key: c.labelKey })} pattern={c.pattern} desc={translate({ key: c.descKey })} mode={modeOf(c.pattern)} onMode={(m) => { setMode(c.pattern, m); }} />)}
          </div>
        </div>
      ))}

      {customCats.map((cat) => (
        <div key={cat}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted mb-2">{cat}</div>
          <div className="flex flex-col gap-1.5">
            {custom.filter((c) => (c.category ?? 'Custom') === cat).map((c) => (
              <CommandRow key={c.id} title={c.title ?? c.pattern} pattern={c.pattern} desc={c.desc} mode={c.mode} onMode={(m) => { setMode(c.pattern, m); }} onDelete={() => { update({ commands: s.commands.filter((x) => x.id !== c.id) }); }} />
            ))}
          </div>
        </div>
      ))}

      <AddCommandForm categories={formCategories} onAdd={addCustom} />
    </div>
  );
}

/* ----------------------------------------------------------------- Integrations */
export function IntegrationsTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const { integrationTools } = useWorkspaces();
  const selected = (toolId: string) => s.tools.find((t) => t.toolId === toolId);
  const toggle = (toolId: string) => { update({ tools: selected(toolId) ? s.tools.filter((t) => t.toolId !== toolId) : [...s.tools, { toolId, tier: 'ro' }] }); };
  const setTier = (toolId: string, tier: ToolTier) => { update({ tools: s.tools.map((t) => (t.toolId === toolId ? { ...t, tier } : t)) }); };
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <FieldLabel
        title={translate({ key: 'workspaces.pipeline.integrations' })}
        hint={translate({ key: 'workspaces.pipeline.integrationsHint' })}
        info={<InfoTip align="start" title={translate({ key: 'workspaces.tips.pipeline.toolTierTitle' })} body={translate({ key: 'workspaces.tips.pipeline.toolTierBody' })} />}
      />
      {integrationTools.length === 0 && (
        <EmptyPicker
          icon="database"
          label={translate({ key: 'workspaces.pipeline.noIntegrationTools' })}
          fix={{ cap: 'workspaceSettings', view: 'workspace', tab: 'integrations', cta: translate({ key: 'workspaces.pipeline.setUpIntegrations' }) }}
        />
      )}
      <div className="flex flex-col gap-1.5">
        {integrationTools.map((tool) => {
          const sel = selected(tool.id);
          return (
            <div key={tool.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${sel ? 'border-primary/40 bg-primary/5' : 'border-container1-border'}`}>
              <Icon name="database" className={sel ? 'text-primary' : 'text-muted'} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-title truncate">{tool.name}</div>
                <div className="text-xs text-muted truncate">{tool.type}{tool.mcp.enabled ? ' · MCP' : ''}</div>
              </div>
              {sel && (
                <div className="inline-flex rounded-lg bg-container2 p-0.5 shrink-0">
                  {(['Read', 'Write'] as const).map((label) => {
                    const tier: ToolTier = label === 'Read' ? 'ro' : 'rw';
                    return <button key={label} type="button" onClick={() => { setTier(tool.id, tier); }} className={`rounded-md px-2.5 h-7 text-xs font-medium cursor-pointer ${sel.tier === tier ? (tier === 'rw' ? 'bg-wrong/15 text-wrong' : 'bg-primary/15 text-primary') : 'text-muted hover:text-common'}`}>{translate({ key: label === 'Read' ? 'workspaces.pipeline.tierRead' : 'workspaces.pipeline.tierWrite' })}</button>;
                  })}
                </div>
              )}
              <Toggle on={Boolean(sel)} onChange={() => { toggle(tool.id); }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Visibility */
export function VisibilityTab({ s, update, stages }: TabProps & { stages: PipelineStageCfg[] }) {
  const translate = useTranslator();
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <FieldLabel title={translate({ key: 'workspaces.pipeline.visibleToStages' })} hint={translate({ key: 'workspaces.pipeline.visibleToStagesHint' })} />
      <div className="flex flex-col gap-1.5">
        {stages.filter((x) => x.id !== s.id).map((other) => (
          <div key={other.id} className="flex items-center gap-3 rounded-xl border border-container1-border px-3 py-2">
            <span className="flex-1 text-sm text-title">{other.name}</span>
            <Toggle on={s.visibleStageIds.includes(other.id)} onChange={() => { update({ visibleStageIds: toggleKey(s.visibleStageIds, other.id) }); }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Process */
export function ProcessTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const setProc = (id: string, patch: Partial<PipelineStageCfg['processes'][number]>) => { update({ processes: s.processes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }); };
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <FieldLabel title={translate({ key: 'workspaces.pipeline.containerProcesses' })} hint={translate({ key: 'workspaces.pipeline.containerProcessesHint' })} />
      {s.processes.length === 0 && <div className="text-sm text-muted">{translate({ key: 'workspaces.pipeline.noProcesses' })}</div>}
      {s.processes.map((p, i) => (
        <div key={p.id} className="rounded-xl border border-container1-border p-3 flex flex-col gap-3">
          {/* flex-wrap: on phone width the cwd group drops below the name instead of squeezing */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-6 h-6 shrink-0 rounded-md bg-container2 text-xs font-semibold text-muted flex items-center justify-center">{i + 1}</span>
            <input value={p.name} onChange={(e) => { setProc(p.id, { name: e.target.value }); }} placeholder="name" className={`w-32 shrink-0 ${inputCls}`} />
            <div className="flex items-center gap-1.5 flex-1 min-w-40">
              <span className="text-xs text-muted shrink-0">{translate({ key: 'workspaces.pipeline.cwd' })}</span>
              <input value={p.cwd} onChange={(e) => { setProc(p.id, { cwd: e.target.value }); }} placeholder="/app" className={`flex-1 min-w-0 font-mono ${inputCls}`} />
            </div>
            <IconButton icon="trash" onClick={() => { update({ processes: s.processes.filter((x) => x.id !== p.id) }); }} size="md" title={translate({ key: 'workspaces.pipeline.removeProcess' })} className="shrink-0 hover:text-wrong" />
          </div>

          <div className="pl-8 flex flex-col gap-1.5">
            <div className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.commandsInOrder' })}</div>
            {p.commands.map((cmd, ci) => (
              // eslint-disable-next-line react-x/no-array-index-key -- editable string[] with no per-row id in the model; index is the row identity
              <div key={ci} className="flex items-center gap-2">
                <span className="text-[11px] text-muted font-mono w-4 shrink-0 text-right">{ci + 1}</span>
                <input value={cmd} onChange={(e) => { setProc(p.id, { commands: p.commands.map((c, j) => (j === ci ? e.target.value : c)) }); }} className={`flex-1 min-w-0 font-mono ${inputCls}`} placeholder="cd packages/api && dotnet run" />
                <IconButton icon="xmark" onClick={() => { setProc(p.id, { commands: p.commands.filter((_, j) => j !== ci) }); }} size="md" title={translate({ key: 'workspaces.pipeline.removeCommandLine' })} className="shrink-0 hover:text-wrong" />
              </div>
            ))}
            <button type="button" onClick={() => { setProc(p.id, { commands: [...p.commands, ''] }); }} className="self-start text-xs text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.pipeline.addCommandLine' })}</button>
          </div>

          <div className="pl-8 flex flex-col gap-1.5">
            <div className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.environmentVariables' })}</div>
            {p.env.map((ev, ei) => (
              // eslint-disable-next-line react-x/no-array-index-key -- editable {key,value}[] with no per-row id in the model; index is the row identity
              <div key={ei} className="flex items-center gap-2">
                <input value={ev.key} onChange={(e) => { setProc(p.id, { env: p.env.map((x, j) => (j === ei ? { ...x, key: e.target.value } : x)) }); }} placeholder="KEY" className={`w-40 shrink-0 font-mono ${inputCls}`} />
                <span className="text-muted">{translate({ key: 'workspaces.pipeline.equals' })}</span>
                <input value={ev.value} onChange={(e) => { setProc(p.id, { env: p.env.map((x, j) => (j === ei ? { ...x, value: e.target.value } : x)) }); }} placeholder="value" className={`flex-1 min-w-0 font-mono ${inputCls}`} />
                <IconButton icon="xmark" onClick={() => { setProc(p.id, { env: p.env.filter((_, j) => j !== ei) }); }} size="md" title={translate({ key: 'workspaces.pipeline.removeEnvVar' })} className="shrink-0 hover:text-wrong" />
              </div>
            ))}
            <button type="button" onClick={() => { setProc(p.id, { env: [...p.env, { key: '', value: '' }] }); }} className="self-start text-xs text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.pipeline.addEnvVar' })}</button>
          </div>
        </div>
      ))}
      <WsButton variant="secondary" icon="plus" onClick={() => { update({ processes: [...s.processes, { id: `proc-${String(Date.now())}`, name: 'process', cwd: '/app', env: [], commands: [''] }] }); }}>{translate({ key: 'workspaces.pipeline.addProcess' })}</WsButton>
    </div>
  );
}

/* ----------------------------------------------------------------- Carry-over */
//? One field, at the end of the chain instead of the start (owner decision 2026-08-20).
//?
//? What was here: a list of `{{summary}}` / `{{changedFiles}}` chips you clicked into a template, so you
//? pre-wrote the next stage's opening sentence with holes in it — for output that did not exist yet.
//? Two things were wrong with that. It was work you had to redo per stage on every project, and it asked
//? the wrong party: the AI that just finished the work knows what is worth passing on, and had no say.
//?
//? Now the receiving end is composed automatically (renderIncomingHandover) and the only thing you set is
//? what THIS stage should tell the next one.
export function CarryoverTab({ s, update, bp }: TabProps) {
  const translate = useTranslator();
  const { activeWorkspace, aiSkills } = useWorkspaces();
  const carryLayers = resolveAiLayers({ workspace: activeWorkspace, skills: aiSkills, stage: s });
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* flow */}
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-lg bg-primary/12 px-2.5 py-1.5 text-primary font-medium">{translate({ key: 'workspaces.pipeline.carryFlowEmit' })}</span>
        <Icon name="angle-right" className="text-muted" />
        <span className="rounded-lg bg-container2 px-2.5 py-1.5 text-common">{translate({ key: 'workspaces.pipeline.carryFlowInject' })}</span>
      </div>

      <div>
        <FieldLabel
          title={translate({ key: 'workspaces.pipeline.handoverPrompt' })}
          hint={translate({ key: 'workspaces.pipeline.handoverPromptHint' })}
          note={<LayerNote layers={carryLayers} id="carryOver" />}
          info={<><LayerTip layers={carryLayers} id="carryOver" stageId={s.id} /><UseDefault value={s.handoverPrompt} fallback={bp?.handoverPrompt} onUse={(text) => { update({ handoverPrompt: text }); }} /><InfoTip align="start" title={translate({ key: 'workspaces.tips.pipeline.handoverTitle' })} body={translate({ key: 'workspaces.tips.pipeline.handoverBody' })} /></>}
        />
        <textarea rows={4} value={s.handoverPrompt} onChange={(e) => { update({ handoverPrompt: e.target.value }); }} className={areaCls} placeholder={translate({ key: 'workspaces.pipeline.handoverPromptPlaceholder' })} />
      </div>

      {/* Reference, not configuration: the shape is fixed, and seeing it answers "what does the next
          stage actually receive?" without implying there is something here to set. */}
      <Disclosure summary={translate({ key: 'workspaces.pipeline.emitDisclosure' })} className="bg-container2/20">
        <div className="text-xs text-muted mb-2">{translate({ key: 'workspaces.pipeline.outgoingEmitHint' })}</div>
        <pre className="rounded-xl border border-container1-border bg-container2/40 p-3 text-xs font-mono text-common overflow-x-auto">{EMIT_SCHEMA_SAMPLE}</pre>
      </Disclosure>
    </div>
  );
}

/* ----------------------------------------------------------------- Model & Effort */
function ChoiceControls({ choice, onChange }: { choice: StageModelChoice; onChange: (p: Partial<StageModelChoice>) => void }) {
  const translate = useTranslator();
  //? ADR 0322 — the tiers are abstract; the workspace's coding-agent config says which concrete model the
  //? picked tier runs on, so show that resolution right here instead of leaving "haiku" to be guessed at.
  const { codingAgent } = useWorkspaces();
  const resolvedModel = `→ ${codingAgent.tierModels[choice.model]}`;
  const modelOpts: { id: StageModelTier; label: string }[] = [{ id: 'haiku', label: translate({ key: 'workspaces.pipeline.modelHaiku' }) }, { id: 'sonnet', label: translate({ key: 'workspaces.pipeline.modelSonnet' }) }, { id: 'opus', label: translate({ key: 'workspaces.pipeline.modelOpus' }) }];
  const effortOpts: { id: StageEffort; label: string }[] = [{ id: 'low', label: translate({ key: 'workspaces.pipeline.effortLow' }) }, { id: 'medium', label: translate({ key: 'workspaces.pipeline.effortMed' }) }, { id: 'high', label: translate({ key: 'workspaces.pipeline.effortHigh' }) }, { id: 'xhigh', label: translate({ key: 'workspaces.pipeline.effortXHigh' }) }, { id: 'max', label: translate({ key: 'workspaces.pipeline.effortMax' }) }];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented<StageModelTier> value={choice.model} onChange={(v) => { onChange({ model: v }); }} options={modelOpts} />
      <Segmented<StageEffort> value={choice.effort} onChange={(v) => { onChange({ effort: v }); }} options={effortOpts} />
      <div className="flex items-center gap-1.5"><span className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.turns' })}</span><input type="number" min={1} value={choice.maxTurns} onChange={(e) => { onChange({ maxTurns: Number(e.target.value) }); }} className={`w-16 ${inputCls}`} /></div>
      <span className="text-xs text-meta font-mono" title={translate({ key: 'workspaces.pipeline.tierResolves' })}>{resolvedModel}</span>
    </div>
  );
}

export function ModelTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const m = s.modelCfg;
  const setBase = (patch: Partial<StageModelChoice>) => { update({ modelCfg: { ...m, base: { ...m.base, ...patch } } }); };
  const setRule = (id: string, patch: Partial<StageModelChoice & { minScore: number }>) => { update({ modelCfg: { ...m, rules: m.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) } }); };
  const addRule = () => { update({ modelCfg: { ...m, rules: [...m.rules, { id: `rule-${String(Date.now())}`, minScore: 5, model: 'sonnet', effort: 'medium', maxTurns: 20 }] } }); };
  const sortedRules = m.rules.toSorted((a, b) => b.minScore - a.minScore);
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex items-start gap-3 rounded-xl border border-container1-border px-3 py-2.5">
        <div className="flex-1">
          <div className="text-sm font-medium text-title">{translate({ key: 'workspaces.pipeline.letAgentPickModel' })}</div>
          <div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.pipeline.letAgentPickModelDesc' })}</div>
        </div>
        <Toggle on={m.autoEscalate} onChange={(v) => { update({ modelCfg: { ...m, autoEscalate: v } }); }} />
      </div>

      {/* the two branches below are mutually exclusive views of the same field — Collapse keeps the
          swap from snapping (the whole point of the toggle right above it). */}
      <Collapse open={!m.autoEscalate}>
        <div>
          <FieldLabel title={translate({ key: 'workspaces.pipeline.model' })} />
          <ChoiceControls choice={m.base} onChange={setBase} />
        </div>
      </Collapse>

      <Collapse open={m.autoEscalate}>
        <div>
          <FieldLabel
            title={translate({ key: 'workspaces.pipeline.escalationBands' })}
            hint={translate({ key: 'workspaces.pipeline.escalationBandsHint' })}
            info={<InfoTip align="start" title={translate({ key: 'workspaces.tips.pipeline.escalationScoreTitle' })} body={translate({ key: 'workspaces.tips.pipeline.escalationScoreBody' })} />}
          />
          <div className="flex flex-col gap-2">
            {sortedRules.map((r) => (
              <div key={r.id} className="rounded-xl border border-container1-border p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-common">{translate({ key: 'workspaces.pipeline.scoreGte' })}</span>
                  <input type="number" min={1} max={10} value={r.minScore} onChange={(e) => { setRule(r.id, { minScore: Number(e.target.value) }); }} className={`w-16 ${inputCls}`} />
                  <span className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.outOfTen' })}</span>
                  <IconButton icon="trash" onClick={() => { update({ modelCfg: { ...m, rules: m.rules.filter((x) => x.id !== r.id) } }); }} size="md" title={translate({ key: 'workspaces.pipeline.removeModelRule' })} className="ml-auto hover:text-wrong" />
                </div>
                <ChoiceControls choice={r} onChange={(p) => { setRule(r.id, p); }} />
              </div>
            ))}
            {/* fixed fallback band — always last, can't be removed, score locked at 0 */}
            <div className="rounded-xl border border-dashed border-container1-border p-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">{translate({ key: 'workspaces.pipeline.scoreGte' })}</span>
                <input type="number" value={0} disabled className={`w-16 opacity-50 cursor-not-allowed ${inputCls}`} />
                <span className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.outOfTen' })}</span>
                <span className="ml-auto rounded-md bg-container2 px-2 py-0.5 text-[11px] font-medium text-muted">{translate({ key: 'workspaces.pipeline.fallback' })}</span>
              </div>
              <ChoiceControls choice={m.base} onChange={setBase} />
            </div>
            <WsButton variant="secondary" icon="plus" onClick={addRule}>{translate({ key: 'workspaces.pipeline.addBand' })}</WsButton>
          </div>
        </div>
      </Collapse>

      {/* #4 self-handoff: per-stage token budget (blank = the worker default). */}
      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.contextBudget' })} hint={translate({ key: 'workspaces.pipeline.contextBudgetHint' })} />
        <input
          type="number" min={0} step={10_000}
          value={m.contextBudgetTokens ?? ''}
          onChange={(e) => { const v = e.target.value.trim(); update({ modelCfg: { ...m, contextBudgetTokens: v === '' ? undefined : Number(v) } }); }}
          placeholder={translate({ key: 'workspaces.pipeline.contextBudgetPlaceholder' })}
          className={`w-44 ${inputCls}`}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Network */
export function NetworkTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const n = s.network;
  const [newDomain, setNewDomain] = useState('');
  const toggleCat = (key: string) => { update({ network: { ...n, categories: n.categories.includes(key) ? n.categories.filter((c) => c !== key) : [...n.categories, key] } }); };
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {/* F-007 — honesty notice, not a hidden tab: nothing server-side reads cfg.network yet (egress is the
          single host-wide squid allowlist in server/container/egress.ts — WS_EGRESS / WS_EGRESS_ALLOW).
          A security-looking control that is silently inert is worse than one that says so. Remove this
          block the day launchTicketContainer honours the per-stage config. */}
      <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5">
        <Icon name="triangle-exclamation" className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-title">{translate({ key: 'workspaces.pipeline.networkNotEnforcedTitle' })}</div>
          <div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.pipeline.networkNotEnforcedBody' })}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-container1-border px-3 py-2.5">
        <div className="flex-1"><div className="text-sm font-medium text-title">{translate({ key: 'workspaces.pipeline.networkEgress' })}</div><div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.pipeline.networkEgressDesc' })}</div></div>
        <Toggle on={n.enabled} onChange={(v) => { update({ network: { ...n, enabled: v } }); }} />
      </div>
      <Collapse open={n.enabled}>
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel title={translate({ key: 'workspaces.pipeline.mode' })} />
            <Segmented<NetworkMode> value={n.mode} onChange={(v) => { update({ network: { ...n, mode: v } }); }} options={[{ id: 'whitelist', label: translate({ key: 'workspaces.pipeline.modeAllowOnly' }) }, { id: 'blacklist', label: translate({ key: 'workspaces.pipeline.modeBlock' }) }]} />
            <div className="text-xs text-muted mt-1.5">{n.mode === 'whitelist' ? translate({ key: 'workspaces.pipeline.whitelistDesc' }) : translate({ key: 'workspaces.pipeline.blacklistDesc' })}</div>
          </div>
          <div>
            <FieldLabel title={translate({ key: 'workspaces.pipeline.categories' })} />
            <div className="flex flex-col gap-1.5">
              {NETWORK_CATEGORIES.map((c) => (
                <button key={c.key} type="button" onClick={() => { toggleCat(c.key); }} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left cursor-pointer transition-colors ${n.categories.includes(c.key) ? 'border-primary/40 bg-primary/5' : 'border-container1-border hover:bg-container2/40'}`}>
                  <Icon name={n.categories.includes(c.key) ? 'circle-check' : 'plus'} className={`text-xs shrink-0 ${n.categories.includes(c.key) ? 'text-primary' : 'text-muted'}`} />
                  <div className="min-w-0 flex-1"><div className="text-sm text-title">{translate({ key: c.labelKey })}</div><div className="text-xs text-muted truncate">{translate({ key: c.descKey })}</div></div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel title={translate({ key: 'workspaces.pipeline.hostsPrefixes' })} hint={translate({ key: 'workspaces.pipeline.hostsPrefixesHint' })} />
            <div className="flex flex-wrap items-center gap-2">
              {n.domains.map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-container2 px-2.5 py-1 text-xs font-mono text-common">
                  {d}<button type="button" onClick={() => { update({ network: { ...n, domains: n.domains.filter((x) => x !== d) } }); }} aria-label={translate({ key: 'workspaces.pipeline.removeDomain', params: [{ key: 'name', value: d }] })} className="cursor-pointer hover:text-wrong"><Icon name="xmark" className="text-[10px]" /></button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input value={newDomain} onChange={(e) => { setNewDomain(e.target.value); }} placeholder="*.github.com" className={`font-mono ${inputCls}`} />
              <WsButton variant="secondary" icon="plus" onClick={() => { const d = newDomain.trim(); if (!d) return; update({ network: { ...n, domains: [...new Set([...n.domains, d])] } }); setNewDomain(''); }}>{translate({ key: 'workspaces.pipeline.add' })}</WsButton>
            </div>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

/* ----------------------------------------------------------------- Hooks */
export function HooksTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const categories = [...new Set(HOOK_CATALOG.map((h) => h.categoryKey))];
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <FieldLabel title={translate({ key: 'workspaces.pipeline.lifecycleHooks' })} hint={translate({ key: 'workspaces.pipeline.lifecycleHooksHint' })} />
      {categories.map((cat) => (
        <div key={cat}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted mb-2">{translate({ key: cat })}</div>
          <div className="flex flex-col gap-1.5">
            {HOOK_CATALOG.filter((h) => h.categoryKey === cat).map((h) => (
              <div key={h.key} className="flex items-start gap-3 rounded-xl border border-container1-border px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-title">{translate({ key: h.labelKey })}</span>
                    <span className="rounded-md bg-container2 px-1.5 py-0.5 text-[10px] font-mono text-muted">{h.matcher}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">{translate({ key: h.descKey })}</div>
                  <div className="text-[11px] text-primary mt-0.5">{translate({ key: 'workspaces.pipeline.stageFeeds', params: [{ key: 'feeds', value: translate({ key: h.feedsKey }) }] })}</div>
                </div>
                {/* F29 — a required hook shows as permanently on rather than as a switch that silently
                    refuses: the engine's turn-detection depends on it. */}
                {/* F-008 — the default mirrors the ENGINE (renderStage: a hook runs unless explicitly false); the
                    conductor writes hooks:{} for new/seeded stages, so `?? false` showed OFF for hooks that ran. */}
                {h.required === true
                  ? <span className="text-[11px] rounded-md bg-primary/10 text-primary px-1.5 py-0.5 shrink-0 mt-0.5">{translate({ key: 'workspaces.pipeline.hookRequired' })}</span>
                  : <Toggle on={s.hooks[h.key] ?? true} onChange={(v) => { update({ hooks: { ...s.hooks, [h.key]: v } }); }} />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
