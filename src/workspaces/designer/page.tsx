//? intent: Designer — one place to keep the whole product UI consistent. Browse every
//? component we ship (buttons, dropdowns, inputs, overlays…) rendered LIVE, switch between
//? multiple design themes (incl. AI-generated ones), and see every component instantly
//? re-render in the selected theme so you can pick what fits. The gallery reads the real
//? component library, so anything the coding-agent adds to `src/_components` shows up here.

import { useState } from 'react';

import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import MultiSelectDropdown from 'src/_components/dropdown/MultiSelectDropdown';
import TextField from 'src/_components/inputs/TextField';
import InputToggle from 'src/_components/inputs/Toggle';
import Checkbox from 'src/_components/inputs/Checkbox';
import DatePicker from 'src/_components/inputs/DatePicker';
import BasePopover from 'src/_components/inputs/Popover';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import {
  AvatarBubble, AvatarStack, EmptyState, IconButton, InfoDot, LabelChip, PopMenu,
  Segmented, StatusPill, Tabs, Toggle as WsToggle, WsButton,
} from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { Member, TicketStatus } from '../_data/types';
import {
  COLOR_TOKENS, LUCKYSTACK_THEME, SEED_THEMES, TOKEN_GROUPS, blankTheme, themeVars,
  type ColorToken, type DesignTheme, type ThemeMode, type ThemeSource, type ThemeTokens,
} from './themes';

//? Coerce an AI-returned (loosely-typed) token map into a complete client ThemeTokens set,
//? filling any omission from the given base — so an AI theme is always a valid 30-token set.
function coerceTokens(raw: unknown, base: ThemeTokens): ThemeTokens {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...base };
  for (const t of COLOR_TOKENS) { const v = obj[t]; if (typeof v === 'string' && v.trim().length > 0) out[t] = v.trim(); }
  return out;
}

export const template = 'workspaces';

//? Demo people for the avatar showcase (data, not app content → no i18n needed).
const DEMO_MEMBERS: Member[] = [
  { id: 'd1', name: 'Ada Lovelace', email: 'ada@x.io', avatarFallback: '#6366F1', role: 'owner' },
  { id: 'd2', name: 'Alan Turing', email: 'alan@x.io', avatarFallback: '#0EA5E9', role: 'admin' },
  { id: 'd3', name: 'Grace Hopper', email: 'grace@x.io', avatarFallback: '#10B981', role: 'member' },
  { id: 'd4', name: 'Linus T.', email: 'linus@x.io', avatarFallback: '#F59E0B', role: 'member' },
];
const ALL_STATUSES: TicketStatus[] = ['busy', 'needs-input', 'done', 'idle', 'paused', 'stuck'];
const DEMO_LABELS = ['bug', 'feature', 'frontend', 'auth', 'perf', 'security'];
const APPLE: DropdownItem = { id: 'apple', value: 'apple', item: 'Apple' };
const FRUIT: DropdownItem[] = [APPLE, { id: 'banana', value: 'banana', item: 'Banana' }, { id: 'cherry', value: 'cherry', item: 'Cherry' }];
const TAG_FRONTEND: DropdownItem = { id: 1, value: 1, item: 'Frontend' };
const TAGS: DropdownItem[] = [TAG_FRONTEND, { id: 2, value: 2, item: 'Backend' }, { id: 3, value: 3, item: 'Design' }];

//? Sample labels used inside the showcase (demo content, not app UI prose — kept as data so
//? the gallery stays a pure showcase and `react/jsx-no-literals` doesn't flag the examples).
const DEMO = {
  primary: 'Primary', secondary: 'Secondary', ghost: 'Ghost', danger: 'Danger', disabled: 'Disabled',
  signedIn: 'Signed in as Ada', profile: 'Profile', signOut: 'Sign out', popover: 'Popover', newItem: 'New item',
} as const;

//? The gallery sections. Each `render` returns live instances of our real components; the
//? whole gallery renders inside a theme-scoped wrapper, so every instance re-themes at once.
interface Section { key: string; title: string; sub: string; render: () => React.ReactNode }

export default function Designer() {
  const translate = useTranslator();
  const { activeWorkspace } = useWorkspaces();
  //? Client-held theme library (seeds + AI-generated; persistence lands in a later phase).
  const [themes, setThemes] = useState<DesignTheme[]>(SEED_THEMES);
  const [activeId, setActiveId] = useState<string>(LUCKYSTACK_THEME.id);
  const [mode, setMode] = useState<ThemeMode>('light');
  const [editing, setEditing] = useState(false);
  //? AI theme generation (feature `designer-theme`).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(false);

  const generateAiTheme = () => {
    const prompt = aiPrompt.trim();
    const workspaceId = activeWorkspace.id;
    if (!prompt || !workspaceId || aiBusy) return;
    setAiBusy(true);
    setAiError(false);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/designerGenerateTheme', version: 'v1', data: { workspaceId, prompt } }));
      if (error || res?.status !== 'success') { setAiError(true); setAiBusy(false); return; }
      const r = res.result;
      const t: DesignTheme = {
        id: `ai-${String(themes.length)}-${String(prompt.length)}`,
        name: r.name || 'AI theme',
        description: r.description,
        source: 'ai',
        light: coerceTokens(r.light, LUCKYSTACK_THEME.light),
        dark: coerceTokens(r.dark, LUCKYSTACK_THEME.dark),
      };
      setThemes((prev) => [...prev, t]);
      setActiveId(t.id);
      setAiPrompt('');
      setAiOpen(false);
      setAiBusy(false);
    })();
  };

  const active = themes.find((t) => t.id === activeId) ?? LUCKYSTACK_THEME;
  const tokens = active[mode];

  const addTheme = () => {
    const n = themes.filter((t) => t.source === 'manual').length + 1;
    const t = blankTheme(`custom-${String(n)}-${String(themes.length)}`, `Custom ${String(n)}`);
    setThemes((prev) => [...prev, t]);
    setActiveId(t.id);
    setEditing(true);
  };
  const duplicateTheme = () => {
    const t: DesignTheme = { ...active, id: `${active.id}-copy-${String(themes.length)}`, name: `${active.name} copy`, source: 'manual', light: { ...active.light }, dark: { ...active.dark } };
    setThemes((prev) => [...prev, t]);
    setActiveId(t.id);
  };
  const setToken = (token: ColorToken, value: string) => {
    setThemes((prev) => prev.map((t) => {
      if (t.id !== activeId) return t;
      const src: ThemeSource = t.source === 'seed' ? 'seed' : 'manual';
      const nextTokens: Record<ColorToken, string> = { ...t[mode], [token]: value };
      return mode === 'light' ? { ...t, source: src, light: nextTokens } : { ...t, source: src, dark: nextTokens };
    }));
  };
  const removeTheme = (id: string) => {
    setThemes((prev) => prev.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(LUCKYSTACK_THEME.id);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ---- Left rail: theme library ---- */}
      <div className="w-64 shrink-0 border-r border-divider flex flex-col min-h-0">
        <div className="px-4 pt-4 pb-2 shrink-0">
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.designer.themes' })}</div>
          <div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.designer.themesSub' })}</div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
          {themes.map((t) => (
            <ThemeRow key={t.id} theme={t} mode={mode} active={t.id === activeId}
              onSelect={() => { setActiveId(t.id); }}
              onRemove={t.source === 'seed' ? undefined : () => { removeTheme(t.id); }} />
          ))}
        </div>
        <div className="shrink-0 border-t border-divider p-2 flex flex-col gap-1.5">
          <button type="button" onClick={addTheme} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-common hover:bg-container2 cursor-pointer">
            <Icon name="plus" className="text-muted" /> {translate({ key: 'workspaces.designer.newTheme' })}
          </button>
          <button type="button" onClick={() => { setAiOpen((v) => !v); setAiError(false); }}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${aiOpen ? 'bg-primary/10 text-primary' : 'text-common hover:bg-container2'}`}>
            <Icon name="wand-magic-sparkles" className={aiOpen ? 'text-primary' : 'text-primary'} /> {translate({ key: 'workspaces.designer.generateAi' })}
          </button>
          {aiOpen && (
            <div className="flex flex-col gap-2 rounded-xl border border-container1-border bg-container1 p-2">
              <textarea value={aiPrompt} onChange={(e) => { setAiPrompt(e.target.value); }} rows={3} disabled={aiBusy}
                placeholder={translate({ key: 'workspaces.designer.aiPlaceholder' })}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generateAiTheme(); } }}
                className="w-full resize-none rounded-lg border border-container1-border bg-container2/40 px-2.5 py-2 text-xs text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
              {aiError && <div className="text-[11px] text-wrong">{translate({ key: 'workspaces.designer.aiError' })}</div>}
              <WsButton icon={aiBusy ? 'spinner' : 'wand-magic-sparkles'} onClick={generateAiTheme} disabled={aiBusy || aiPrompt.trim().length === 0} className={aiBusy ? '[&_svg]:animate-spin' : ''}>
                {translate({ key: aiBusy ? 'workspaces.designer.aiGenerating' : 'workspaces.designer.aiGenerate' })}
              </WsButton>
            </div>
          )}
        </div>
      </div>

      {/* ---- Main: header + live gallery ---- */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* page intro — instantly clear what this page is for */}
        <div className="px-5 md:px-6 pt-5 pb-3 border-b border-divider">
          <div className="flex items-center gap-2 text-title">
            <span className="w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center"><Icon name="palette" /></span>
            <span className="text-xl font-semibold">{translate({ key: 'workspaces.designer.title' })}</span>
          </div>
          <p className="text-sm text-muted mt-1.5 max-w-2xl">{translate({ key: 'workspaces.designer.intro' })}</p>
        </div>

        {/* active-theme toolbar */}
        <div className="px-5 md:px-6 py-3 flex flex-wrap items-center gap-3 border-b border-divider bg-container1/40">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-title truncate">{active.name}</span>
              <SourceBadge source={active.source} />
            </div>
            {active.description && <div className="text-xs text-muted truncate">{active.description}</div>}
          </div>
          <div className="flex-1" />
          <Segmented<ThemeMode>
            options={[{ id: 'light', label: <span className="flex items-center gap-1.5"><Icon name="sun" /> {translate({ key: 'workspaces.designer.light' })}</span> }, { id: 'dark', label: <span className="flex items-center gap-1.5"><Icon name="moon" /> {translate({ key: 'workspaces.designer.dark' })}</span> }]}
            value={mode} onChange={setMode} />
          <WsButton variant={editing ? 'primary' : 'secondary'} icon="sliders" onClick={() => { setEditing((v) => !v); }}>{translate({ key: 'workspaces.designer.editTokens' })}</WsButton>
          <WsButton variant="ghost" icon="copy" onClick={duplicateTheme}>{translate({ key: 'workspaces.designer.duplicate' })}</WsButton>
        </div>

        <div className="flex min-h-0">
          {/* the live, theme-scoped canvas */}
          <div className="flex-1 min-w-0 p-5 md:p-6">
            <div className="rounded-2xl border border-container1-border overflow-hidden" style={themeVars(tokens)}>
              <div className="bg-background text-common p-5 md:p-6 flex flex-col gap-6">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Icon name="eye" /> {translate({ key: 'workspaces.designer.livePreview', params: [{ key: 'theme', value: active.name }, { key: 'mode', value: mode }] })}
                </div>
                <Gallery translate={translate} tokens={tokens} />
              </div>
            </div>
          </div>

          {/* token editor (only when open) */}
          {editing && (
            <div className="w-80 shrink-0 border-l border-divider min-h-0 overflow-y-auto p-4">
              <TokenEditor tokens={tokens} mode={mode} onSet={setToken} translate={translate} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

//? ---- theme rail row: a swatch strip + name + source ----
function ThemeRow({ theme, mode, active, onSelect, onRemove }: { theme: DesignTheme; mode: ThemeMode; active: boolean; onSelect: () => void; onRemove?: () => void }) {
  const t = theme[mode];
  const swatches: ColorToken[] = ['background', 'container1', 'primary', 'title'];
  return (
    <div onClick={onSelect} className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${active ? 'bg-container1 ring-1 ring-primary/40' : 'hover:bg-container1/60'}`}>
      <div className="flex -space-x-1 shrink-0">
        {swatches.map((s) => <span key={s} className="w-4 h-4 rounded-full border border-container1-border" style={{ backgroundColor: t[s] }} />)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-title truncate">{theme.name}</div>
      </div>
      {onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-muted hover:text-wrong opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"><Icon name="trash-can" className="text-xs" /></button>}
    </div>
  );
}

function SourceBadge({ source }: { source: DesignTheme['source'] }) {
  const translate = useTranslator();
  const meta = source === 'seed' ? { icon: 'star', tint: 'bg-container2 text-muted' } : (source === 'ai' ? { icon: 'wand-magic-sparkles', tint: 'bg-primary/12 text-primary' } : { icon: 'pen', tint: 'bg-container2 text-common' });
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tint}`}><Icon name={meta.icon} className="text-[10px]" />{translate({ key: `workspaces.designer.source.${source}` })}</span>;
}

//? ---- the component gallery (live instances of our real library) ----
type Translate = ReturnType<typeof useTranslator>;
function Gallery({ translate, tokens }: { translate: Translate; tokens: Record<ColorToken, string> }) {
  //? Interactive demo state — one per stateful control.
  const [text, setText] = useState('Ada Lovelace');
  const [num, setNum] = useState('3');
  const [search, setSearch] = useState('');
  const [toggle1, setToggle1] = useState(true);
  const [toggle2, setToggle2] = useState(false);
  const [check1, setCheck1] = useState(true);
  const [check2, setCheck2] = useState(false);
  const [wsToggle, setWsToggle] = useState(true);
  const [seg, setSeg] = useState<'board' | 'list'>('board');
  const [tab, setTab] = useState('overview');
  const [fruit, setFruit] = useState<DropdownItem>(APPLE);
  const [tags, setTags] = useState<DropdownItem[]>([TAG_FRONTEND]);
  const [date, setDate] = useState<Date | null>(null);

  const sections: Section[] = [
    {
      key: 'buttons', title: translate({ key: 'workspaces.designer.sec.buttons' }), sub: translate({ key: 'workspaces.designer.sec.buttonsSub' }),
      render: () => (
        <div className="flex flex-wrap items-center gap-3">
          <WsButton icon="check">{DEMO.primary}</WsButton>
          <WsButton variant="secondary" icon="pen">{DEMO.secondary}</WsButton>
          <WsButton variant="ghost" icon="arrow-left">{DEMO.ghost}</WsButton>
          <WsButton variant="danger" icon="trash-can">{DEMO.danger}</WsButton>
          <WsButton icon="rotate" disabled>{DEMO.disabled}</WsButton>
          <div className="w-px h-6 bg-divider" />
          <IconButton icon="gear" />
          <IconButton icon="bell" active />
          <IconButton icon="ellipsis" />
        </div>
      ),
    },
    {
      key: 'selects', title: translate({ key: 'workspaces.designer.sec.selects' }), sub: translate({ key: 'workspaces.designer.sec.selectsSub' }),
      render: () => (
        <div className="flex flex-wrap items-start gap-4">
          <DemoField label="Dropdown · md"><Dropdown items={FRUIT} value={fruit} onChange={setFruit} size="md" /></DemoField>
          <DemoField label="Dropdown · lg · search"><Dropdown items={FRUIT} value={fruit} onChange={setFruit} size="lg" showSearch /></DemoField>
          <DemoField label="Multi-select"><MultiSelectDropdown items={TAGS} value={tags} onChange={setTags} selectedCountText={(n) => `${String(n)} selected`} size="md" /></DemoField>
        </div>
      ),
    },
    {
      key: 'inputs', title: translate({ key: 'workspaces.designer.sec.inputs' }), sub: translate({ key: 'workspaces.designer.sec.inputsSub' }),
      render: () => (
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          <TextField label="Text" value={text} onChange={setText} leftIcon={faMagnifyingGlass} clearable />
          <TextField type="number" label="Number" value={num} onChange={setNum} min={0} max={99} />
          <TextField type="password" label="Password" value="hunter2" onChange={() => { /* demo */ }} />
          <TextField type="search" label="Search" value={search} onChange={setSearch} placeholder="Type to filter…" />
          <div className="flex flex-col gap-3">
            <InputToggle checked={toggle1} onChange={setToggle1} label="Email notifications" />
            <InputToggle checked={toggle2} onChange={setToggle2} label="Compact mode" size="sm" />
          </div>
          <div className="flex flex-col gap-3">
            <Checkbox checked={check1} onChange={setCheck1} label="I agree to the terms" />
            <Checkbox checked={check2} onChange={setCheck2} label="Subscribe" indeterminate />
          </div>
          <DatePicker label="Due date" value={date} onChange={setDate} />
        </div>
      ),
    },
    {
      key: 'controls', title: translate({ key: 'workspaces.designer.sec.controls' }), sub: translate({ key: 'workspaces.designer.sec.controlsSub' }),
      render: () => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <Segmented<'board' | 'list'> options={[{ id: 'board', label: 'Board' }, { id: 'list', label: 'List' }]} value={seg} onChange={setSeg} />
            <WsToggle on={wsToggle} onChange={setWsToggle} label="Workspace toggle" />
          </div>
          <div className="max-w-md">
            <Tabs tabs={[{ id: 'overview', label: 'Overview', icon: 'table-columns' }, { id: 'activity', label: 'Activity', icon: 'wave-square', count: 3 }, { id: 'settings', label: 'Settings', icon: 'gear' }]} active={tab} onChange={setTab} />
          </div>
        </div>
      ),
    },
    {
      key: 'overlays', title: translate({ key: 'workspaces.designer.sec.overlays' }), sub: translate({ key: 'workspaces.designer.sec.overlaysSub' }),
      render: () => (
        <div className="flex flex-wrap items-center gap-4">
          <BasePopover content={<div className="flex flex-col gap-1 text-sm text-common"><div className="font-medium text-title mb-1">{DEMO.signedIn}</div><button type="button" className="text-left hover:text-primary cursor-pointer">{DEMO.profile}</button><button type="button" className="text-left hover:text-primary cursor-pointer">{DEMO.signOut}</button></div>}>
            <WsButton variant="secondary" icon="caret-down">{DEMO.popover}</WsButton>
          </BasePopover>
          <PopMenu items={[{ label: 'Edit', icon: 'pen' }, { label: 'Duplicate', icon: 'copy' }, { divider: true }, { label: 'Delete', icon: 'trash-can', danger: true }]} triggerClass="inline-flex items-center gap-2 rounded-xl px-3.5 h-9 text-sm font-medium bg-container2 text-title hover:bg-container2-hover cursor-pointer" />
          <WsButton variant="secondary" icon="triangle-exclamation" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.designer.confirmDemoTitle' }), content: translate({ key: 'workspaces.designer.confirmDemoBody' }) }); }}>{translate({ key: 'workspaces.designer.openConfirm' })}</WsButton>
          <InfoDot title="Info dot" body={translate({ key: 'workspaces.designer.infoDotBody' })} align="left" />
        </div>
      ),
    },
    {
      key: 'data', title: translate({ key: 'workspaces.designer.sec.data' }), sub: translate({ key: 'workspaces.designer.sec.dataSub' }),
      render: () => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">{ALL_STATUSES.map((s) => <StatusPill key={s} status={s} />)}</div>
          <div className="flex flex-wrap items-center gap-1.5">{DEMO_LABELS.map((l) => <LabelChip key={l} name={l} />)}</div>
          <div className="flex items-center gap-4">
            <AvatarStack users={DEMO_MEMBERS} max={3} size={28} />
            <div className="flex items-center gap-2">{DEMO_MEMBERS.slice(0, 3).map((m) => <AvatarBubble key={m.id} user={m} size={32} />)}</div>
          </div>
          <EmptyState icon="inbox" title={translate({ key: 'workspaces.designer.emptyDemoTitle' })} sub={translate({ key: 'workspaces.designer.emptyDemoSub' })} action={<WsButton icon="plus">{DEMO.newItem}</WsButton>} />
        </div>
      ),
    },
    {
      key: 'tokens', title: translate({ key: 'workspaces.designer.sec.tokens' }), sub: translate({ key: 'workspaces.designer.sec.tokensSub' }),
      render: () => (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {COLOR_TOKENS.map((tk) => (
            <div key={tk} className="flex items-center gap-2 rounded-lg border border-container1-border bg-container1 p-2">
              <span className="w-8 h-8 rounded-md border border-container1-border shrink-0" style={{ backgroundColor: tokens[tk] }} />
              <div className="min-w-0">
                <div className="text-[11px] text-title truncate">{tk}</div>
                <div className="text-[10px] text-muted font-mono truncate">{tokens[tk]}</div>
              </div>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {sections.map((s) => (
        <div key={s.key} className="rounded-xl border border-container1-border bg-container1 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-divider">
            <div className="text-sm font-semibold text-title">{s.title}</div>
            <div className="text-xs text-muted">{s.sub}</div>
          </div>
          <div className="p-4">{s.render()}</div>
        </div>
      ))}
    </div>
  );
}

function DemoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </div>
  );
}

//? ---- token editor: grouped colour inputs; edits the active theme's active mode ----
function TokenEditor({ tokens, mode, onSet, translate }: { tokens: Record<ColorToken, string>; mode: ThemeMode; onSet: (t: ColorToken, v: string) => void; translate: Translate }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.designer.editorTitle' })}</div>
        <div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.designer.editorSub', params: [{ key: 'mode', value: mode }] })}</div>
      </div>
      {TOKEN_GROUPS.map((g) => (
        <div key={g.key}>
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">{g.label}</div>
          <div className="flex flex-col gap-1.5">
            {g.tokens.map((tk) => {
              const val = tokens[tk];
              const isHex = /^#[0-9a-fA-F]{6}$/.test(val);
              return (
                <div key={tk} className="flex items-center gap-2">
                  <input type="color" value={isHex ? val : '#000000'} onChange={(e) => { onSet(tk, e.target.value); }} className="w-8 h-8 rounded-md border border-container1-border cursor-pointer bg-transparent p-0.5 shrink-0" title={isHex ? undefined : translate({ key: 'workspaces.designer.notHex' })} />
                  <span className="text-[11px] text-common flex-1 truncate">{tk}</span>
                  <input value={val} onChange={(e) => { onSet(tk, e.target.value); }} className="w-24 h-7 px-2 rounded-md border border-container1-border bg-container2/40 text-[11px] font-mono text-title focus:outline-none focus:border-primary" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
