//? Workspaces — Pipeline editor. THE core surface: tickets flow through these
//? configurable stages, each running its own AI in its own container. Mirrors
//? the genormaliseerd PipelineStage model + child collections and the rendered
//? claudeSettings (model / effort / max-turns / hooks). Stack-agnostic — the
//? same config drives Node, .NET, Go, … projects. See handoff/DATAMODEL.md §2 +
//? CLAUDE_SETTINGS_MAP.md. Local state for the prototype.

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { AnimatePresence, motion } from 'motion/react';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../_components/Icon';
import { IconButton, InfoDot, Segmented, Tabs, Toggle, WsButton, type TabDef } from '../_components/primitives';
import { CARRY_VARS, COMMAND_CATALOG, HOOK_CATALOG, NETWORK_CATEGORIES, STAGE_CONFIGS } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { CommandMode, NetworkMode, PipelineStageCfg, StageEffort, StageModelChoice, StageModelTier, StageWarning, ToolTier } from '../_data/types';

interface TabProps { s: PipelineStageCfg; update: (patch: Partial<PipelineStageCfg>) => void }

const MODE_TINT: Record<CommandMode, string> = { allow: 'bg-correct/15 text-correct', ask: 'bg-warning/15 text-warning', deny: 'bg-wrong/15 text-wrong' };

const inputCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
const areaCls = 'w-full px-3 py-2 rounded-lg border border-container1-border bg-container2/50 text-sm text-title font-mono leading-relaxed focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

//? Toggle a key's presence in a string array (used by the context + visibility tabs).
const toggleKey = (arr: string[], key: string): string[] => (arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]);

//? The carry-over schema each stage must emit — a code sample, not translatable UI copy.
const EMIT_SCHEMA_SAMPLE = `{
  "summary": "string",
  "changedFiles": ["path", …],
  "openQuestions": ["string", …],
  "commitHash": "string"
}`;

function FieldLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-1.5">
      <div className="text-sm font-medium text-title">{title}</div>
      {hint && <div className="text-xs text-muted mt-0.5">{hint}</div>}
    </div>
  );
}

function blankStage(id: string, name: string, order: number): PipelineStageCfg {
  return {
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

/* ----------------------------------------------------------------- General */
function GeneralTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const [newStatus, setNewStatus] = useState('');
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.customInstructions' })} hint={translate({ key: 'workspaces.pipeline.customInstructionsHint' })} />
        <textarea rows={4} value={s.customInstructions} onChange={(e) => { update({ customInstructions: e.target.value }); }} className={areaCls} placeholder={translate({ key: 'workspaces.pipeline.customInstructionsPlaceholder' })} />
      </div>
      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.statuses' })} hint={translate({ key: 'workspaces.pipeline.statusesHint' })} />
        <div className="flex flex-wrap items-center gap-2">
          {s.statuses.map((st) => (
            <span key={st.key} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${st.kind === 'base' ? 'bg-container2 text-common' : 'bg-primary/12 text-primary'}`}>
              {st.label}
              {st.kind === 'custom' && <button type="button" onClick={() => { update({ statuses: s.statuses.filter((x) => x.key !== st.key) }); }} className="cursor-pointer hover:text-wrong"><Icon name="xmark" className="text-[10px]" /></button>}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input value={newStatus} onChange={(e) => { setNewStatus(e.target.value); }} placeholder={translate({ key: 'workspaces.pipeline.addStatusPlaceholder' })} className={inputCls} />
          <WsButton variant="secondary" onClick={() => { const l = newStatus.trim(); if (!l) return; update({ statuses: [...s.statuses, { key: l.toLowerCase().replaceAll(/\s+/g, '-'), label: l, kind: 'custom' }] }); setNewStatus(''); }}>{translate({ key: 'workspaces.pipeline.add' })}</WsButton>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Context & Skills */
function ContextTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const { docs, skills } = useWorkspaces();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.contextDocs' })} hint={translate({ key: 'workspaces.pipeline.contextDocsHint' })} />
        <div className="flex flex-col gap-1.5">
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
      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.skillsMcp' })} hint={translate({ key: 'workspaces.pipeline.skillsMcpHint' })} />
        <div className="flex flex-col gap-1.5">
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
      {onDelete && <button type="button" onClick={onDelete} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="trash" className="text-xs" /></button>}
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
  if (!open) return <WsButton variant="secondary" icon="plus" onClick={() => { setOpen(true); }}>{translate({ key: 'workspaces.pipeline.addCommand' })}</WsButton>;
  return (
    <div className="rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.pipeline.category' })}</div>
          <Dropdown size="sm" value={items.find((i) => i.id === catId)} items={items} onChange={(it) => { setCatId(String(it.id)); }} />
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
  );
}

function CommandsTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const catalogPatterns = useMemo(() => new Set(COMMAND_CATALOG.flatMap((g) => g.commands.map((c) => c.pattern))), []);
  const custom = s.commands.filter((c) => !catalogPatterns.has(c.pattern));
  const customCats = [...new Set(custom.map((c) => c.category ?? 'Custom'))];
  const formCategories = [...new Set([...COMMAND_CATALOG.map((g) => g.category), ...customCats])];
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
      <FieldLabel title={translate({ key: 'workspaces.pipeline.commandPermissions' })} hint={translate({ key: 'workspaces.pipeline.commandPermissionsHint' })} />
      {COMMAND_CATALOG.map((group) => (
        <div key={group.category}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted mb-2">{group.category}</div>
          <div className="flex flex-col gap-1.5">
            {group.commands.map((c) => <CommandRow key={c.pattern} title={c.label} pattern={c.pattern} desc={c.desc} mode={modeOf(c.pattern)} onMode={(m) => { setMode(c.pattern, m); }} />)}
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
function IntegrationsTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const { integrationTools, navigate } = useWorkspaces();
  const selected = (toolId: string) => s.tools.find((t) => t.toolId === toolId);
  const toggle = (toolId: string) => { update({ tools: selected(toolId) ? s.tools.filter((t) => t.toolId !== toolId) : [...s.tools, { toolId, tier: 'ro' }] }); };
  const setTier = (toolId: string, tier: ToolTier) => { update({ tools: s.tools.map((t) => (t.toolId === toolId ? { ...t, tier } : t)) }); };
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <FieldLabel title={translate({ key: 'workspaces.pipeline.integrations' })} hint={translate({ key: 'workspaces.pipeline.integrationsHint' })} />
      {integrationTools.length === 0 && (
        <div className="rounded-xl border border-container1-border bg-container2/40 p-4 text-sm text-muted flex items-center justify-between gap-3">
          <span>{translate({ key: 'workspaces.pipeline.noIntegrationTools' })}</span>
          <WsButton variant="secondary" icon="database" onClick={() => { navigate('workspace'); }}>{translate({ key: 'workspaces.pipeline.setUpIntegrations' })}</WsButton>
        </div>
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
function VisibilityTab({ s, update, stages }: TabProps & { stages: PipelineStageCfg[] }) {
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
function ProcessTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const setProc = (id: string, patch: Partial<PipelineStageCfg['processes'][number]>) => { update({ processes: s.processes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }); };
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <FieldLabel title={translate({ key: 'workspaces.pipeline.containerProcesses' })} hint={translate({ key: 'workspaces.pipeline.containerProcessesHint' })} />
      {s.processes.length === 0 && <div className="text-sm text-muted">{translate({ key: 'workspaces.pipeline.noProcesses' })}</div>}
      {s.processes.map((p, i) => (
        <div key={p.id} className="rounded-xl border border-container1-border p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 shrink-0 rounded-md bg-container2 text-xs font-semibold text-muted flex items-center justify-center">{i + 1}</span>
            <input value={p.name} onChange={(e) => { setProc(p.id, { name: e.target.value }); }} placeholder="name" className={`w-32 shrink-0 ${inputCls}`} />
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-xs text-muted shrink-0">{translate({ key: 'workspaces.pipeline.cwd' })}</span>
              <input value={p.cwd} onChange={(e) => { setProc(p.id, { cwd: e.target.value }); }} placeholder="/app" className={`flex-1 min-w-0 font-mono ${inputCls}`} />
            </div>
            <button type="button" onClick={() => { update({ processes: s.processes.filter((x) => x.id !== p.id) }); }} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="trash" className="text-xs" /></button>
          </div>

          <div className="pl-8 flex flex-col gap-1.5">
            <div className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.commandsInOrder' })}</div>
            {p.commands.map((cmd, ci) => (
              <div key={ci} className="flex items-center gap-2">
                <span className="text-[11px] text-muted font-mono w-4 shrink-0 text-right">{ci + 1}</span>
                <input value={cmd} onChange={(e) => { setProc(p.id, { commands: p.commands.map((c, j) => (j === ci ? e.target.value : c)) }); }} className={`flex-1 min-w-0 font-mono ${inputCls}`} placeholder="cd packages/api && dotnet run" />
                <button type="button" onClick={() => { setProc(p.id, { commands: p.commands.filter((_, j) => j !== ci) }); }} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="xmark" className="text-xs" /></button>
              </div>
            ))}
            <button type="button" onClick={() => { setProc(p.id, { commands: [...p.commands, ''] }); }} className="self-start text-xs text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.pipeline.addCommandLine' })}</button>
          </div>

          <div className="pl-8 flex flex-col gap-1.5">
            <div className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.environmentVariables' })}</div>
            {p.env.map((ev, ei) => (
              <div key={ei} className="flex items-center gap-2">
                <input value={ev.key} onChange={(e) => { setProc(p.id, { env: p.env.map((x, j) => (j === ei ? { ...x, key: e.target.value } : x)) }); }} placeholder="KEY" className={`w-40 shrink-0 font-mono ${inputCls}`} />
                <span className="text-muted">{translate({ key: 'workspaces.pipeline.equals' })}</span>
                <input value={ev.value} onChange={(e) => { setProc(p.id, { env: p.env.map((x, j) => (j === ei ? { ...x, value: e.target.value } : x)) }); }} placeholder="value" className={`flex-1 min-w-0 font-mono ${inputCls}`} />
                <button type="button" onClick={() => { setProc(p.id, { env: p.env.filter((_, j) => j !== ei) }); }} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="xmark" className="text-xs" /></button>
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
function CarryoverTab({ s, update }: TabProps) {
  const translate = useTranslator();
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* flow */}
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-lg bg-container2 px-2.5 py-1.5 text-common">{translate({ key: 'workspaces.pipeline.carryFlowEmit' })}</span>
        <Icon name="angle-right" className="text-muted" />
        <span className="rounded-lg bg-primary/12 px-2.5 py-1.5 text-primary font-medium">{translate({ key: 'workspaces.pipeline.carryFlowInject' })}</span>
        <Icon name="angle-right" className="text-muted" />
        <span className="rounded-lg bg-container2 px-2.5 py-1.5 text-common">{translate({ key: 'workspaces.pipeline.carryFlowSameShape' })}</span>
      </div>

      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.incomingVariables' })} hint={translate({ key: 'workspaces.pipeline.incomingVariablesHint' })} />
        <div className="flex flex-col gap-1.5">
          {CARRY_VARS.map((v) => (
            <div key={v.token} className="flex items-center gap-3 rounded-xl border border-container1-border px-3 py-2">
              <button type="button" onClick={() => { update({ promptTemplate: `${s.promptTemplate}${s.promptTemplate && !s.promptTemplate.endsWith('\n') ? ' ' : ''}${v.token}` }); }} className="rounded-md bg-container2 px-2 py-1 text-xs font-mono text-primary hover:bg-container2-hover cursor-pointer shrink-0">{v.token}</button>
              <span className="text-xs text-muted">{v.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.promptTemplate' })} hint={translate({ key: 'workspaces.pipeline.promptTemplateHint' })} />
        <textarea rows={5} value={s.promptTemplate} onChange={(e) => { update({ promptTemplate: e.target.value }); }} className={areaCls} placeholder="Implement the plan.\nPlan: {{summary}}" />
      </div>

      <div>
        <FieldLabel title={translate({ key: 'workspaces.pipeline.outgoingEmit' })} hint={translate({ key: 'workspaces.pipeline.outgoingEmitHint' })} />
        <pre className="rounded-xl border border-container1-border bg-container2/40 p-3 text-xs font-mono text-common overflow-x-auto">{EMIT_SCHEMA_SAMPLE}</pre>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Model & Effort */
function ChoiceControls({ choice, onChange }: { choice: StageModelChoice; onChange: (p: Partial<StageModelChoice>) => void }) {
  const translate = useTranslator();
  const modelOpts: { id: StageModelTier; label: string }[] = [{ id: 'haiku', label: translate({ key: 'workspaces.pipeline.modelHaiku' }) }, { id: 'sonnet', label: translate({ key: 'workspaces.pipeline.modelSonnet' }) }, { id: 'opus', label: translate({ key: 'workspaces.pipeline.modelOpus' }) }];
  const effortOpts: { id: StageEffort; label: string }[] = [{ id: 'low', label: translate({ key: 'workspaces.pipeline.effortLow' }) }, { id: 'medium', label: translate({ key: 'workspaces.pipeline.effortMed' }) }, { id: 'high', label: translate({ key: 'workspaces.pipeline.effortHigh' }) }, { id: 'xhigh', label: translate({ key: 'workspaces.pipeline.effortXHigh' }) }, { id: 'max', label: translate({ key: 'workspaces.pipeline.effortMax' }) }];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented<StageModelTier> value={choice.model} onChange={(v) => { onChange({ model: v }); }} options={modelOpts} />
      <Segmented<StageEffort> value={choice.effort} onChange={(v) => { onChange({ effort: v }); }} options={effortOpts} />
      <div className="flex items-center gap-1.5"><span className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.turns' })}</span><input type="number" min={1} value={choice.maxTurns} onChange={(e) => { onChange({ maxTurns: Number(e.target.value) }); }} className={`w-16 ${inputCls}`} /></div>
    </div>
  );
}

function ModelTab({ s, update }: TabProps) {
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

      {!m.autoEscalate && (
        <div>
          <FieldLabel title={translate({ key: 'workspaces.pipeline.model' })} />
          <ChoiceControls choice={m.base} onChange={setBase} />
        </div>
      )}

      {m.autoEscalate && (
        <div>
          <FieldLabel title={translate({ key: 'workspaces.pipeline.escalationBands' })} hint={translate({ key: 'workspaces.pipeline.escalationBandsHint' })} />
          <div className="flex flex-col gap-2">
            {sortedRules.map((r) => (
              <div key={r.id} className="rounded-xl border border-container1-border p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-common">{translate({ key: 'workspaces.pipeline.scoreGte' })}</span>
                  <input type="number" min={1} max={10} value={r.minScore} onChange={(e) => { setRule(r.id, { minScore: Number(e.target.value) }); }} className={`w-16 ${inputCls}`} />
                  <span className="text-xs text-muted">{translate({ key: 'workspaces.pipeline.outOfTen' })}</span>
                  <button type="button" onClick={() => { update({ modelCfg: { ...m, rules: m.rules.filter((x) => x.id !== r.id) } }); }} className="ml-auto text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center"><Icon name="trash" className="text-xs" /></button>
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
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Network */
function NetworkTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const n = s.network;
  const [newDomain, setNewDomain] = useState('');
  const toggleCat = (key: string) => { update({ network: { ...n, categories: n.categories.includes(key) ? n.categories.filter((c) => c !== key) : [...n.categories, key] } }); };
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex items-center gap-3 rounded-xl border border-container1-border px-3 py-2.5">
        <div className="flex-1"><div className="text-sm font-medium text-title">{translate({ key: 'workspaces.pipeline.networkEgress' })}</div><div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.pipeline.networkEgressDesc' })}</div></div>
        <Toggle on={n.enabled} onChange={(v) => { update({ network: { ...n, enabled: v } }); }} />
      </div>
      {n.enabled && (
        <>
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
                  <div className="min-w-0 flex-1"><div className="text-sm text-title">{c.label}</div><div className="text-xs text-muted truncate">{c.desc}</div></div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel title={translate({ key: 'workspaces.pipeline.hostsPrefixes' })} hint={translate({ key: 'workspaces.pipeline.hostsPrefixesHint' })} />
            <div className="flex flex-wrap items-center gap-2">
              {n.domains.map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-container2 px-2.5 py-1 text-xs font-mono text-common">
                  {d}<button type="button" onClick={() => { update({ network: { ...n, domains: n.domains.filter((x) => x !== d) } }); }} className="cursor-pointer hover:text-wrong"><Icon name="xmark" className="text-[10px]" /></button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input value={newDomain} onChange={(e) => { setNewDomain(e.target.value); }} placeholder="*.github.com" className={`font-mono ${inputCls}`} />
              <WsButton variant="secondary" icon="plus" onClick={() => { const d = newDomain.trim(); if (!d) return; update({ network: { ...n, domains: [...new Set([...n.domains, d])] } }); setNewDomain(''); }}>{translate({ key: 'workspaces.pipeline.add' })}</WsButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Hooks */
function HooksTab({ s, update }: TabProps) {
  const translate = useTranslator();
  const categories = [...new Set(HOOK_CATALOG.map((h) => h.category))];
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <FieldLabel title={translate({ key: 'workspaces.pipeline.lifecycleHooks' })} hint={translate({ key: 'workspaces.pipeline.lifecycleHooksHint' })} />
      {categories.map((cat) => (
        <div key={cat}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted mb-2">{cat}</div>
          <div className="flex flex-col gap-1.5">
            {HOOK_CATALOG.filter((h) => h.category === cat).map((h) => (
              <div key={h.key} className="flex items-start gap-3 rounded-xl border border-container1-border px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-title">{h.label}</span>
                    <span className="rounded-md bg-container2 px-1.5 py-0.5 text-[10px] font-mono text-muted">{h.matcher}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">{h.desc}</div>
                  <div className="text-[11px] text-primary mt-0.5">{translate({ key: 'workspaces.pipeline.stageFeeds', params: [{ key: 'feeds', value: h.feeds }] })}</div>
                </div>
                <Toggle on={s.hooks[h.key] ?? false} onChange={(v) => { update({ hooks: { ...s.hooks, [h.key]: v } }); }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- main */
export default function Pipeline() {
  const translate = useTranslator();
  const { activeWorkspace } = useWorkspaces();
  const [stages, setStages] = useState<PipelineStageCfg[]>(STAGE_CONFIGS);
  const [selectedId, setSelectedId] = useState<string>(STAGE_CONFIGS[0].id);
  const [tab, setTab] = useState('general');
  const [warnings, setWarnings] = useState<StageWarning[]>([]);

  const s = stages.find((x) => x.id === selectedId) ?? stages[0];
  const update = (patch: Partial<PipelineStageCfg>) => { setStages((p) => p.map((st) => (st.id === selectedId ? { ...st, ...patch } : st))); };

  const move = (dir: -1 | 1) => { setStages((p) => {
    const i = p.findIndex((x) => x.id === selectedId);
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const copy = [...p];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy.map((st, idx) => ({ ...st, order: idx }));
  }); };

  const addStage = () => {
    const id = `stage-${String(stages.length)}-${String(Date.now())}`;
    setStages((p) => [...p, blankStage(id, `Stage ${String(p.length + 1)}`, p.length)]);
    setSelectedId(id);
    setTab('general');
  };

  const removeStage = () => void menuHandler.confirm({ title: translate({ key: 'workspaces.pipeline.deleteStageConfirmTitle', params: [{ key: 'name', value: s.name }] }), content: translate({ key: 'workspaces.pipeline.deleteStageConfirmContent' }) }).then((ok) => {
    if (!ok) return;
    const fallback = stages.find((x) => x.id !== selectedId)?.id ?? '';
    setStages((p) => p.filter((x) => x.id !== selectedId).map((st, idx) => ({ ...st, order: idx })));
    setSelectedId(fallback);
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

  const configTabs: TabDef[] = [
    { id: 'general', label: translate({ key: 'workspaces.pipeline.tabGeneral' }), icon: 'sliders' },
    { id: 'context', label: translate({ key: 'workspaces.pipeline.tabContext' }), icon: 'book-open' },
    { id: 'commands', label: translate({ key: 'workspaces.pipeline.tabCommands' }), icon: 'terminal' },
    { id: 'integrations', label: translate({ key: 'workspaces.pipeline.integrations' }), icon: 'database' },
    { id: 'visibility', label: translate({ key: 'workspaces.pipeline.tabVisibility' }), icon: 'eye' },
    { id: 'process', label: translate({ key: 'workspaces.pipeline.tabProcess' }), icon: 'play' },
    { id: 'carryover', label: translate({ key: 'workspaces.pipeline.tabCarryover' }), icon: 'code-merge' },
    { id: 'model', label: translate({ key: 'workspaces.pipeline.tabModel' }), icon: 'bolt' },
    { id: 'network', label: translate({ key: 'workspaces.pipeline.tabNetwork' }), icon: 'shield-halved' },
    { id: 'hooks', label: translate({ key: 'workspaces.pipeline.tabHooks' }), icon: 'link' },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.pipeline.pipelineTitle' })}</h1>
          <span className="text-sm text-muted">{translate({ key: 'workspaces.pipeline.headerSummary', params: [{ key: 'name', value: activeWorkspace.name }, { key: 'count', value: String(stages.length) }] })}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <WsButton variant="secondary" icon="wand-magic-sparkles" onClick={validate}>{translate({ key: 'workspaces.pipeline.validateWithAi' })}</WsButton>
          <WsButton icon="plus" onClick={addStage}>{translate({ key: 'workspaces.pipeline.addStage' })}</WsButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8 flex flex-col gap-4">
        {/* flow strip */}
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
                  <div key={i} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${w.severity === 'warn' ? 'border-warning/40 bg-warning/10' : 'border-container1-border bg-container2/40'}`}>
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

        {/* selected stage */}
        <div className="rounded-2xl border border-container1-border bg-container1">
          <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-divider">
            <input value={s.name} onChange={(e) => { update({ name: e.target.value }); }} className="text-base font-semibold text-title bg-transparent focus:outline-none border-b border-transparent focus:border-primary min-w-0 flex-1" />
            <div className="flex items-center gap-2 shrink-0">
              <Toggle on={s.aiEnabled} onChange={(v) => { update({ aiEnabled: v }); }} label={s.aiEnabled ? translate({ key: 'workspaces.pipeline.aiOn' }) : translate({ key: 'workspaces.pipeline.noAi' })} />
              <IconButton icon="angle-left" title={translate({ key: 'workspaces.pipeline.moveEarlier' })} onClick={() => { move(-1); }} />
              <IconButton icon="angle-right" title={translate({ key: 'workspaces.pipeline.moveLater' })} onClick={() => { move(1); }} />
              <IconButton icon="trash" title={translate({ key: 'workspaces.pipeline.deleteStage' })} onClick={removeStage} className="hover:text-wrong" />
            </div>
          </div>

          <div className="px-4 md:px-5 pt-2">
            <Tabs tabs={configTabs} active={tab} onChange={setTab} />
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
      </div>
    </div>
  );
}
