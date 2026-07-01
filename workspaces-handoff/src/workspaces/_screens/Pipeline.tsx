//? Workspaces — Pipeline editor. THE core surface: tickets flow through these
//? configurable stages, each running its own AI in its own container. Mirrors
//? the genormaliseerd PipelineStage model + child collections and the rendered
//? claudeSettings (model / effort / max-turns / hooks). Stack-agnostic — the
//? same config drives Node, .NET, Go, … projects. See handoff/DATAMODEL.md §2 +
//? CLAUDE_SETTINGS_MAP.md. Local state for the prototype.

import { useMemo, useState } from 'react';

import { AnimatePresence, motion } from 'motion/react';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/Dropdown';

import Icon from '../_components/Icon';
import { IconButton, InfoDot, Segmented, Tabs, Toggle, WsButton, type TabDef } from '../_components/primitives';
import { CARRY_VARS, COMMAND_CATALOG, DOCS, HOOK_CATALOG, NETWORK_CATEGORIES, SKILLS, STAGE_CONFIGS } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { CommandMode, NetworkMode, PipelineStageCfg, StageEffort, StageModelChoice, StageModelTier, StageWarning, ToolTier } from '../_data/types';

interface TabProps { s: PipelineStageCfg; update: (patch: Partial<PipelineStageCfg>) => void }

const CONFIG_TABS: TabDef[] = [
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'context', label: 'Context & Skills', icon: 'book-open' },
  { id: 'commands', label: 'Commands', icon: 'terminal' },
  { id: 'integrations', label: 'Integrations', icon: 'database' },
  { id: 'visibility', label: 'Visibility', icon: 'eye' },
  { id: 'process', label: 'Process', icon: 'play' },
  { id: 'carryover', label: 'Carry-over', icon: 'code-merge' },
  { id: 'model', label: 'Model & Effort', icon: 'bolt' },
  { id: 'network', label: 'Network', icon: 'shield-halved' },
  { id: 'hooks', label: 'Hooks', icon: 'link' },
];

const MODEL_OPTS: { id: StageModelTier; label: string }[] = [{ id: 'haiku', label: 'Haiku' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'opus', label: 'Opus' }];
const EFFORT_OPTS: { id: StageEffort; label: string }[] = [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Med' }, { id: 'high', label: 'High' }, { id: 'xhigh', label: 'X-High' }, { id: 'max', label: 'Max' }];
const MODE_TINT: Record<CommandMode, string> = { allow: 'bg-correct/15 text-correct', ask: 'bg-warning/15 text-warning', deny: 'bg-wrong/15 text-wrong' };

const inputCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
const areaCls = 'w-full px-3 py-2 rounded-lg border border-container1-border bg-container2/50 text-sm text-title font-mono leading-relaxed focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

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
    id, name, order, aiEnabled: true, customInstructions: '', promptTemplate: '',
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
  const [newStatus, setNewStatus] = useState('');
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div>
        <FieldLabel title="Custom instructions" hint="Loaded into the stage's CLAUDE.md — domain rules + per-stage goals." />
        <textarea rows={4} value={s.customInstructions} onChange={(e) => update({ customInstructions: e.target.value })} className={areaCls} placeholder="e.g. Follow the plan exactly. Keep changes surgical." />
      </div>
      <div>
        <FieldLabel title="Statuses" hint="Base statuses are always present. “Stopped” is set when you stop all AIs or the subscription limit is hit. Add custom chips for this stage." />
        <div className="flex flex-wrap items-center gap-2">
          {s.statuses.map((st) => (
            <span key={st.key} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${st.kind === 'base' ? 'bg-container2 text-common' : 'bg-primary/12 text-primary'}`}>
              {st.label}
              {st.kind === 'custom' && <button type="button" onClick={() => update({ statuses: s.statuses.filter((x) => x.key !== st.key) })} className="cursor-pointer hover:text-wrong"><Icon name="xmark" className="text-[10px]" /></button>}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input value={newStatus} onChange={(e) => setNewStatus(e.target.value)} placeholder="Add custom status…" className={inputCls} />
          <WsButton variant="secondary" onClick={() => { const l = newStatus.trim(); if (!l) return; update({ statuses: [...s.statuses, { key: l.toLowerCase().replaceAll(/\s+/g, '-'), label: l, kind: 'custom' }] }); setNewStatus(''); }}>Add</WsButton>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Context & Skills */
function ContextTab({ s, update }: TabProps) {
  const toggleKey = (arr: string[], key: string) => (arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <FieldLabel title="Context docs" hint="Loaded into the container once, read-only." />
        <div className="flex flex-col gap-1.5">
          {DOCS.map((d) => {
            const on = s.sourceIds.includes(d.id);
            return (
              <button key={d.id} type="button" onClick={() => update({ sourceIds: toggleKey(s.sourceIds, d.id) })} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left cursor-pointer transition-colors ${on ? 'border-primary/40 bg-primary/5' : 'border-container1-border hover:bg-container2/40'}`}>
                <Icon name="file-lines" className={on ? 'text-primary' : 'text-muted'} />
                <div className="min-w-0 flex-1"><div className="text-sm text-title truncate">{d.name}</div><div className="text-xs text-muted line-clamp-2">{d.summary}</div></div>
                <Icon name={on ? 'circle-check' : 'plus'} className={`text-xs shrink-0 ${on ? 'text-primary' : 'text-muted'}`} />
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <FieldLabel title="Skills / MCP" hint="Queried on demand. Frozen-per-commit or live." />
        <div className="flex flex-col gap-1.5">
          {SKILLS.map((sk) => {
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
                <Toggle on={on} onChange={() => update({ skillKeys: toggleKey(s.skillKeys, sk.id) })} />
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
  const opts: [string, CommandMode | null][] = [['Off', null], ['Allow', 'allow'], ['Ask', 'ask'], ['Deny', 'deny']];
  return (
    <div className="inline-flex rounded-lg bg-container2 p-0.5 shrink-0">
      {opts.map(([label, val]) => (
        <button key={label} type="button" onClick={() => onChange(val)} className={`rounded-md px-2 h-7 text-xs font-medium cursor-pointer transition-colors ${value === val ? (val ? MODE_TINT[val] : 'bg-container1 text-title shadow-sm') : 'text-muted hover:text-common'}`}>{label}</button>
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
  const [open, setOpen] = useState(false);
  const [catId, setCatId] = useState(categories[0] ?? 'Custom');
  const [newCat, setNewCat] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [pattern, setPattern] = useState('');
  const isNew = catId === '__new__';
  const items = [...categories.map((c) => ({ id: c, value: c, item: c })), { id: '__new__', value: '__new__', item: '＋ New category…' }];
  const submit = () => {
    const category = (isNew ? newCat : catId).trim();
    const t = title.trim(); const p = pattern.trim();
    if (!category || !t || !p) return;
    onAdd({ category, title: t, desc: desc.trim(), pattern: p });
    setTitle(''); setDesc(''); setPattern(''); setNewCat(''); setOpen(false);
  };
  if (!open) return <WsButton variant="secondary" icon="plus" onClick={() => setOpen(true)}>Add command</WsButton>;
  return (
    <div className="rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted mb-1">Category</div>
          <Dropdown size="sm" value={items.find((i) => i.id === catId)} items={items} onChange={(it) => setCatId(String(it.id))} />
        </div>
        {isNew && <div><div className="text-xs text-muted mb-1">New category</div><input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="e.g. Migrations" className={`w-full ${inputCls}`} /></div>}
      </div>
      <div><div className="text-xs text-muted mb-1">Title</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Run database migrations" className={`w-full ${inputCls}`} /></div>
      <div><div className="text-xs text-muted mb-1">Description <span className="text-muted/70">(optional)</span></div><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What this command does + why it's allowed" className={`w-full ${inputCls}`} /></div>
      <div><div className="text-xs text-muted mb-1">Command</div><input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Bash(npm run migrate)" className={`w-full font-mono ${inputCls}`} /></div>
      <div className="flex items-center gap-2">
        <WsButton icon="plus" onClick={submit}>Add</WsButton>
        <WsButton variant="ghost" onClick={() => setOpen(false)}>Cancel</WsButton>
      </div>
    </div>
  );
}

function CommandsTab({ s, update }: TabProps) {
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
      <FieldLabel title="Command permissions" hint="Pick the commands this stage may run — Allow runs silently, Ask prompts, Deny blocks (deny wins). Hover ? for what each does. Maps to .claude permission rules." />
      {COMMAND_CATALOG.map((group) => (
        <div key={group.category}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted mb-2">{group.category}</div>
          <div className="flex flex-col gap-1.5">
            {group.commands.map((c) => <CommandRow key={c.pattern} title={c.label} pattern={c.pattern} desc={c.desc} mode={modeOf(c.pattern)} onMode={(m) => setMode(c.pattern, m)} />)}
          </div>
        </div>
      ))}

      {customCats.map((cat) => (
        <div key={cat}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted mb-2">{cat}</div>
          <div className="flex flex-col gap-1.5">
            {custom.filter((c) => (c.category ?? 'Custom') === cat).map((c) => (
              <CommandRow key={c.id} title={c.title ?? c.pattern} pattern={c.pattern} desc={c.desc} mode={c.mode} onMode={(m) => setMode(c.pattern, m)} onDelete={() => update({ commands: s.commands.filter((x) => x.id !== c.id) })} />
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
  const { integrationTools, navigate } = useWorkspaces();
  const selected = (toolId: string) => s.tools.find((t) => t.toolId === toolId);
  const toggle = (toolId: string) => update({ tools: selected(toolId) ? s.tools.filter((t) => t.toolId !== toolId) : [...s.tools, { toolId, tier: 'ro' }] });
  const setTier = (toolId: string, tier: ToolTier) => update({ tools: s.tools.map((t) => (t.toolId === toolId ? { ...t, tier } : t)) });
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <FieldLabel title="Integrations" hint="Pick which workspace integration tools this stage may use + the access tier. Read-only is enforced at the MCP-handler. Configure tools in Workspace settings → Integrations." />
      {integrationTools.length === 0 && (
        <div className="rounded-xl border border-container1-border bg-container2/40 p-4 text-sm text-muted flex items-center justify-between gap-3">
          <span>No integration tools configured for this workspace yet.</span>
          <WsButton variant="secondary" icon="database" onClick={() => navigate('workspace')}>Set up integrations</WsButton>
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
                    return <button key={label} type="button" onClick={() => setTier(tool.id, tier)} className={`rounded-md px-2.5 h-7 text-xs font-medium cursor-pointer ${sel.tier === tier ? (tier === 'rw' ? 'bg-wrong/15 text-wrong' : 'bg-primary/15 text-primary') : 'text-muted hover:text-common'}`}>{label}</button>;
                  })}
                </div>
              )}
              <Toggle on={Boolean(sel)} onChange={() => toggle(tool.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Visibility */
function VisibilityTab({ s, update, stages }: TabProps & { stages: PipelineStageCfg[] }) {
  const toggleKey = (arr: string[], key: string) => (arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]);
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <FieldLabel title="Visible to other stages" hint="Which stages can read this stage via the cross-ticket skill. The source stage controls its own visibility." />
      <div className="flex flex-col gap-1.5">
        {stages.filter((x) => x.id !== s.id).map((other) => (
          <div key={other.id} className="flex items-center gap-3 rounded-xl border border-container1-border px-3 py-2">
            <span className="flex-1 text-sm text-title">{other.name}</span>
            <Toggle on={s.visibleStageIds.includes(other.id)} onChange={() => update({ visibleStageIds: toggleKey(s.visibleStageIds, other.id) })} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Process */
function ProcessTab({ s, update }: TabProps) {
  const setProc = (id: string, patch: Partial<PipelineStageCfg['processes'][number]>) => update({ processes: s.processes.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <FieldLabel title="Container processes" hint="What boots in the stage's container — where it runs (working dir), its env vars, and the ordered commands. Stack-agnostic." />
      {s.processes.length === 0 && <div className="text-sm text-muted">No processes — nothing starts in the container for this stage.</div>}
      {s.processes.map((p, i) => (
        <div key={p.id} className="rounded-xl border border-container1-border p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 shrink-0 rounded-md bg-container2 text-xs font-semibold text-muted flex items-center justify-center">{i + 1}</span>
            <input value={p.name} onChange={(e) => setProc(p.id, { name: e.target.value })} placeholder="name" className={`w-32 shrink-0 ${inputCls}`} />
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-xs text-muted shrink-0">cwd</span>
              <input value={p.cwd} onChange={(e) => setProc(p.id, { cwd: e.target.value })} placeholder="/app" className={`flex-1 min-w-0 font-mono ${inputCls}`} />
            </div>
            <button type="button" onClick={() => update({ processes: s.processes.filter((x) => x.id !== p.id) })} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="trash" className="text-xs" /></button>
          </div>

          <div className="pl-8 flex flex-col gap-1.5">
            <div className="text-xs text-muted">Commands (run in order)</div>
            {p.commands.map((cmd, ci) => (
              <div key={ci} className="flex items-center gap-2">
                <span className="text-[11px] text-muted font-mono w-4 shrink-0 text-right">{ci + 1}</span>
                <input value={cmd} onChange={(e) => setProc(p.id, { commands: p.commands.map((c, j) => (j === ci ? e.target.value : c)) })} className={`flex-1 min-w-0 font-mono ${inputCls}`} placeholder="cd packages/api && dotnet run" />
                <button type="button" onClick={() => setProc(p.id, { commands: p.commands.filter((_, j) => j !== ci) })} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="xmark" className="text-xs" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setProc(p.id, { commands: [...p.commands, ''] })} className="self-start text-xs text-primary hover:underline cursor-pointer">+ command</button>
          </div>

          <div className="pl-8 flex flex-col gap-1.5">
            <div className="text-xs text-muted">Environment variables</div>
            {p.env.map((ev, ei) => (
              <div key={ei} className="flex items-center gap-2">
                <input value={ev.key} onChange={(e) => setProc(p.id, { env: p.env.map((x, j) => (j === ei ? { ...x, key: e.target.value } : x)) })} placeholder="KEY" className={`w-40 shrink-0 font-mono ${inputCls}`} />
                <span className="text-muted">=</span>
                <input value={ev.value} onChange={(e) => setProc(p.id, { env: p.env.map((x, j) => (j === ei ? { ...x, value: e.target.value } : x)) })} placeholder="value" className={`flex-1 min-w-0 font-mono ${inputCls}`} />
                <button type="button" onClick={() => setProc(p.id, { env: p.env.filter((_, j) => j !== ei) })} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="xmark" className="text-xs" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setProc(p.id, { env: [...p.env, { key: '', value: '' }] })} className="self-start text-xs text-primary hover:underline cursor-pointer">+ env var</button>
          </div>
        </div>
      ))}
      <WsButton variant="secondary" icon="plus" onClick={() => update({ processes: [...s.processes, { id: `proc-${String(Date.now())}`, name: 'process', cwd: '/app', env: [], commands: [''] }] })}>Add process</WsButton>
    </div>
  );
}

/* ----------------------------------------------------------------- Carry-over */
function CarryoverTab({ s, update }: TabProps) {
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* flow */}
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-lg bg-container2 px-2.5 py-1.5 text-common">Previous stage emits structured output</span>
        <Icon name="angle-right" className="text-muted" />
        <span className="rounded-lg bg-primary/12 px-2.5 py-1.5 text-primary font-medium">injected into this prompt</span>
        <Icon name="angle-right" className="text-muted" />
        <span className="rounded-lg bg-container2 px-2.5 py-1.5 text-common">this stage emits the same shape</span>
      </div>

      <div>
        <FieldLabel title="Incoming variables" hint="What the previous stage hands you — click to insert into the template." />
        <div className="flex flex-col gap-1.5">
          {CARRY_VARS.map((v) => (
            <div key={v.token} className="flex items-center gap-3 rounded-xl border border-container1-border px-3 py-2">
              <button type="button" onClick={() => update({ promptTemplate: `${s.promptTemplate}${s.promptTemplate && !s.promptTemplate.endsWith('\n') ? ' ' : ''}${v.token}` })} className="rounded-md bg-container2 px-2 py-1 text-xs font-mono text-primary hover:bg-container2-hover cursor-pointer shrink-0">{v.token}</button>
              <span className="text-xs text-muted">{v.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel title="Prompt template" hint="Rendered with the incoming values at stage start (Claude's -p flag + carry-over file)." />
        <textarea rows={5} value={s.promptTemplate} onChange={(e) => update({ promptTemplate: e.target.value })} className={areaCls} placeholder="Implement the plan.\nPlan: {{summary}}" />
      </div>

      <div>
        <FieldLabel title="Outgoing — this stage must emit" hint="Enforced via --json-schema so the next stage can read it. This is how data chains between stages." />
        <pre className="rounded-xl border border-container1-border bg-container2/40 p-3 text-xs font-mono text-common overflow-x-auto">{`{
  "summary": "string",
  "changedFiles": ["path", …],
  "openQuestions": ["string", …],
  "commitHash": "string"
}`}</pre>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Model & Effort */
function ChoiceControls({ choice, onChange }: { choice: StageModelChoice; onChange: (p: Partial<StageModelChoice>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented<StageModelTier> value={choice.model} onChange={(v) => onChange({ model: v })} options={MODEL_OPTS} />
      <Segmented<StageEffort> value={choice.effort} onChange={(v) => onChange({ effort: v })} options={EFFORT_OPTS} />
      <div className="flex items-center gap-1.5"><span className="text-xs text-muted">turns</span><input type="number" min={1} value={choice.maxTurns} onChange={(e) => onChange({ maxTurns: Number(e.target.value) })} className={`w-16 ${inputCls}`} /></div>
    </div>
  );
}

function ModelTab({ s, update }: TabProps) {
  const m = s.modelCfg;
  const setBase = (patch: Partial<StageModelChoice>) => update({ modelCfg: { ...m, base: { ...m.base, ...patch } } });
  const setRule = (id: string, patch: Partial<StageModelChoice & { minScore: number }>) => update({ modelCfg: { ...m, rules: m.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) } });
  const addRule = () => update({ modelCfg: { ...m, rules: [...m.rules, { id: `rule-${String(Date.now())}`, minScore: 5, model: 'sonnet', effort: 'medium', maxTurns: 20 }] } });
  const sortedRules = m.rules.toSorted((a, b) => b.minScore - a.minScore);
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex items-start gap-3 rounded-xl border border-container1-border px-3 py-2.5">
        <div className="flex-1">
          <div className="text-sm font-medium text-title">Let the agent pick the model</div>
          <div className="text-xs text-muted mt-0.5">The agent rates the task 1–10 and chooses the highest matching band below — and may escalate itself upward mid-task.</div>
        </div>
        <Toggle on={m.autoEscalate} onChange={(v) => update({ modelCfg: { ...m, autoEscalate: v } })} />
      </div>

      {!m.autoEscalate && (
        <div>
          <FieldLabel title="Model" />
          <ChoiceControls choice={m.base} onChange={setBase} />
        </div>
      )}

      {m.autoEscalate && (
        <div>
          <FieldLabel title="Escalation bands" hint="if task score ≥ N → use this model / effort / turns. Highest match wins; the bottom band is the default that catches everything else." />
          <div className="flex flex-col gap-2">
            {sortedRules.map((r) => (
              <div key={r.id} className="rounded-xl border border-container1-border p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-common">score ≥</span>
                  <input type="number" min={1} max={10} value={r.minScore} onChange={(e) => setRule(r.id, { minScore: Number(e.target.value) })} className={`w-16 ${inputCls}`} />
                  <span className="text-xs text-muted">/ 10</span>
                  <button type="button" onClick={() => update({ modelCfg: { ...m, rules: m.rules.filter((x) => x.id !== r.id) } })} className="ml-auto text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center"><Icon name="trash" className="text-xs" /></button>
                </div>
                <ChoiceControls choice={r} onChange={(p) => setRule(r.id, p)} />
              </div>
            ))}
            {/* fixed fallback band — always last, can't be removed, score locked at 0 */}
            <div className="rounded-xl border border-dashed border-container1-border p-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">score ≥</span>
                <input type="number" value={0} disabled className={`w-16 opacity-50 cursor-not-allowed ${inputCls}`} />
                <span className="text-xs text-muted">/ 10</span>
                <span className="ml-auto rounded-md bg-container2 px-2 py-0.5 text-[11px] font-medium text-muted">Fallback</span>
              </div>
              <ChoiceControls choice={m.base} onChange={setBase} />
            </div>
            <WsButton variant="secondary" icon="plus" onClick={addRule}>Add band</WsButton>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Network */
function NetworkTab({ s, update }: TabProps) {
  const n = s.network;
  const [newDomain, setNewDomain] = useState('');
  const toggleCat = (key: string) => update({ network: { ...n, categories: n.categories.includes(key) ? n.categories.filter((c) => c !== key) : [...n.categories, key] } });
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex items-center gap-3 rounded-xl border border-container1-border px-3 py-2.5">
        <div className="flex-1"><div className="text-sm font-medium text-title">Network egress</div><div className="text-xs text-muted mt-0.5">Off = the container has no internet at all.</div></div>
        <Toggle on={n.enabled} onChange={(v) => update({ network: { ...n, enabled: v } })} />
      </div>
      {n.enabled && (
        <>
          <div>
            <FieldLabel title="Mode" />
            <Segmented<NetworkMode> value={n.mode} onChange={(v) => update({ network: { ...n, mode: v } })} options={[{ id: 'whitelist', label: 'Allow only these' }, { id: 'blacklist', label: 'Block these' }]} />
            <div className="text-xs text-muted mt-1.5">{n.mode === 'whitelist' ? 'Everything is blocked except the categories + hosts below (locked-down).' : 'Everything is allowed except the categories + hosts below (open).'}</div>
          </div>
          <div>
            <FieldLabel title="Categories" />
            <div className="flex flex-col gap-1.5">
              {NETWORK_CATEGORIES.map((c) => (
                <button key={c.key} type="button" onClick={() => toggleCat(c.key)} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left cursor-pointer transition-colors ${n.categories.includes(c.key) ? 'border-primary/40 bg-primary/5' : 'border-container1-border hover:bg-container2/40'}`}>
                  <Icon name={n.categories.includes(c.key) ? 'circle-check' : 'plus'} className={`text-xs shrink-0 ${n.categories.includes(c.key) ? 'text-primary' : 'text-muted'}`} />
                  <div className="min-w-0 flex-1"><div className="text-sm text-title">{c.label}</div><div className="text-xs text-muted truncate">{c.desc}</div></div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel title="Hosts & prefixes" hint="Exact hosts or wildcard prefixes, e.g. registry.npmjs.org or *.github.com." />
            <div className="flex flex-wrap items-center gap-2">
              {n.domains.map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-container2 px-2.5 py-1 text-xs font-mono text-common">
                  {d}<button type="button" onClick={() => update({ network: { ...n, domains: n.domains.filter((x) => x !== d) } })} className="cursor-pointer hover:text-wrong"><Icon name="xmark" className="text-[10px]" /></button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="*.github.com" className={`font-mono ${inputCls}`} />
              <WsButton variant="secondary" icon="plus" onClick={() => { const d = newDomain.trim(); if (!d) return; update({ network: { ...n, domains: [...new Set([...n.domains, d])] } }); setNewDomain(''); }}>Add</WsButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Hooks */
function HooksTab({ s, update }: TabProps) {
  const categories = [...new Set(HOOK_CATALOG.map((h) => h.category))];
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <FieldLabel title="Lifecycle hooks" hint="Hooks POST to the orchestrator — they power the event-log, status tracking and needs-input escalation. Disabling them blinds those features." />
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
                  <div className="text-[11px] text-primary mt-0.5">→ {h.feeds}</div>
                </div>
                <Toggle on={s.hooks[h.key] ?? false} onChange={(v) => update({ hooks: { ...s.hooks, [h.key]: v } })} />
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
  const { activeWorkspace } = useWorkspaces();
  const [stages, setStages] = useState<PipelineStageCfg[]>(STAGE_CONFIGS);
  const [selectedId, setSelectedId] = useState<string>(STAGE_CONFIGS[0]!.id);
  const [tab, setTab] = useState('general');
  const [warnings, setWarnings] = useState<StageWarning[]>([]);

  const s = stages.find((x) => x.id === selectedId) ?? stages[0]!;
  const update = (patch: Partial<PipelineStageCfg>) => setStages((p) => p.map((st) => (st.id === selectedId ? { ...st, ...patch } : st)));

  const move = (dir: -1 | 1) => setStages((p) => {
    const i = p.findIndex((x) => x.id === selectedId);
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const copy = [...p];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy.map((st, idx) => ({ ...st, order: idx }));
  });

  const addStage = () => {
    const id = `stage-${String(stages.length)}-${String(Date.now())}`;
    setStages((p) => [...p, blankStage(id, `Stage ${String(p.length + 1)}`, p.length)]);
    setSelectedId(id);
    setTab('general');
  };

  const removeStage = () => void menuHandler.confirm({ title: `Delete stage “${s.name}”?`, content: 'Tickets in this stage move to the next one. This cannot be undone.' }).then((ok) => {
    if (!ok) return;
    const fallback = stages.find((x) => x.id !== selectedId)?.id ?? '';
    setStages((p) => p.filter((x) => x.id !== selectedId).map((st, idx) => ({ ...st, order: idx })));
    setSelectedId(fallback);
  });

  const validate = () => {
    const w: StageWarning[] = [];
    for (const st of stages) {
      if (st.aiEnabled && st.skillKeys.length === 0 && st.order !== 0 && st.order !== stages.length - 1)
        w.push({ stageId: st.id, severity: 'info', text: `${st.name} has AI on but no skills enabled — it'll work blind.` });
      if (st.aiEnabled && !st.customInstructions.trim())
        w.push({ stageId: st.id, severity: 'info', text: `${st.name} has no custom instructions.` });
      if (st.tools.some((t) => t.tier === 'rw') && st.id !== 'impl')
        w.push({ stageId: st.id, severity: 'warn', text: `${st.name} has write access to a service — usually only Implementatie needs that.` });
      if (st.aiEnabled && !st.network.enabled && st.skillKeys.length > 0)
        w.push({ stageId: st.id, severity: 'info', text: `${st.name} has network off but uses skills that may need egress.` });
    }
    const refined = stages.find((x) => x.id === 'refined');
    const plan = stages.find((x) => x.id === 'plan');
    if (refined?.skillKeys.includes('rag') && plan && !plan.skillKeys.includes('rag'))
      w.push({ stageId: 'plan', severity: 'warn', text: 'Refined loads RAG but Plan does not — the decision stage usually needs more context, not less.' });
    setWarnings(w);
  };

  const warnFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of warnings) m.set(w.stageId, (m.get(w.stageId) ?? 0) + 1);
    return m;
  }, [warnings]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-title">Pipeline</h1>
          <span className="text-sm text-muted">{activeWorkspace.name} · {stages.length} stages · the AI moves tickets through these</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <WsButton variant="secondary" icon="wand-magic-sparkles" onClick={validate}>Validate with AI</WsButton>
          <WsButton icon="plus" onClick={addStage}>Add stage</WsButton>
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
                  type="button" onClick={() => setSelectedId(st.id)}
                  className={`relative flex items-center gap-2 rounded-xl border px-3 h-11 cursor-pointer transition-colors ${active ? 'border-primary bg-primary/10' : st.aiEnabled ? 'border-container1-border bg-container1 hover:bg-container1-hover' : 'border-container1-border bg-container2/40 hover:bg-container2'}`}
                >
                  <span className={`w-5 h-5 shrink-0 rounded-md text-[11px] font-bold flex items-center justify-center ${active ? 'bg-primary text-title-primary' : 'bg-container2 text-muted'}`}>{i + 1}</span>
                  <span className="text-sm font-medium text-title whitespace-nowrap">{st.name}</span>
                  <Icon name={st.aiEnabled ? 'robot' : 'ban'} className={`text-xs ${st.aiEnabled ? 'text-primary' : 'text-muted'}`} />
                  {warns > 0 && <span className="w-1.5 h-1.5 rounded-full bg-warning" title={`${String(warns)} finding(s)`} />}
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
                    <button type="button" onClick={() => setSelectedId(w.stageId)} className="text-xs text-primary hover:underline cursor-pointer shrink-0">Go to stage</button>
                    <button type="button" onClick={() => setWarnings((p) => p.filter((_, j) => j !== i))} className="text-muted hover:text-title cursor-pointer shrink-0"><Icon name="xmark" className="text-xs" /></button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* selected stage */}
        <div className="rounded-2xl border border-container1-border bg-container1">
          <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-divider">
            <input value={s.name} onChange={(e) => update({ name: e.target.value })} className="text-base font-semibold text-title bg-transparent focus:outline-none border-b border-transparent focus:border-primary min-w-0 flex-1" />
            <div className="flex items-center gap-2 shrink-0">
              <Toggle on={s.aiEnabled} onChange={(v) => update({ aiEnabled: v })} label={s.aiEnabled ? 'AI on' : 'No AI'} />
              <IconButton icon="angle-left" title="Move earlier" onClick={() => move(-1)} />
              <IconButton icon="angle-right" title="Move later" onClick={() => move(1)} />
              <IconButton icon="trash" title="Delete stage" onClick={removeStage} className="hover:text-wrong" />
            </div>
          </div>

          <div className="px-4 md:px-5 pt-2">
            <Tabs tabs={CONFIG_TABS} active={tab} onChange={setTab} />
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
