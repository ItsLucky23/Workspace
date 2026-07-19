//? Designer › Components — browse every component we ship, rendered LIVE under the active theme.
//? Reorganised from one long page into a category rail + search, so it stays scannable. The gallery
//? reads the real component library, so anything the coding-agent adds to `src/_components` shows here.

import { useState } from 'react';

import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import MultiSelectDropdown from 'src/_components/dropdown/MultiSelectDropdown';
import TextField from 'src/_components/inputs/TextField';
import InputToggle from 'src/_components/inputs/Toggle';
import Checkbox from 'src/_components/inputs/Checkbox';
import DatePicker from 'src/_components/inputs/DatePicker';
import BasePopover from 'src/_components/inputs/Popover';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../../_components/Icon';
import {
  AvatarBubble, AvatarStack, EmptyState, IconButton, InfoDot, LabelChip, PopMenu,
  Segmented, StatusPill, Tabs, Toggle as WsToggle, WsButton,
} from '../../../_components/primitives';
import type { Member, TicketStatus } from '../../../_data/types';
import { COLOR_TOKENS, themeVars } from '../themes';
import { useDesigner } from '../state';

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
const TAG_FE: DropdownItem = { id: 1, value: 1, item: 'Frontend' };
const TAGS: DropdownItem[] = [TAG_FE, { id: 2, value: 2, item: 'Backend' }, { id: 3, value: 3, item: 'Design' }];
const DEMO = { primary: 'Primary', secondary: 'Secondary', ghost: 'Ghost', danger: 'Danger', disabled: 'Disabled', signedIn: 'Signed in as Ada', profile: 'Profile', signOut: 'Sign out', popover: 'Popover', newItem: 'New item', default: 'Default', focus: 'Focus', loading: 'Loading', focused: 'Focused', error: 'Error' } as const;
const inputBase = 'h-9 px-3 rounded-lg border bg-container2/40 text-sm text-title focus:outline-none';
const SHADOWS = ['shadow-sm', 'shadow', 'shadow-md', 'shadow-lg', 'shadow-xl'];
const RADII = ['rounded-none', 'rounded', 'rounded-lg', 'rounded-xl', 'rounded-2xl', 'rounded-full'];
const SPACES = [4, 8, 12, 16, 24, 32, 48];

interface Cat { key: string; icon: string; render: () => React.ReactNode }

export default function Components() {
  const translate = useTranslator();
  const { tokens } = useDesigner();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  const [text, setText] = useState('Ada Lovelace');
  const [num, setNum] = useState('3');
  const [search, setSearch] = useState('');
  const [t1, setT1] = useState(true);
  const [t2, setT2] = useState(false);
  const [c1, setC1] = useState(true);
  const [c2, setC2] = useState(false);
  const [wsT, setWsT] = useState(true);
  const [seg, setSeg] = useState<'board' | 'list'>('board');
  const [tab, setTab] = useState('overview');
  const [fruit, setFruit] = useState<DropdownItem>(APPLE);
  const [tags, setTags] = useState<DropdownItem[]>([TAG_FE]);
  const [date, setDate] = useState<Date | null>(null);

  const cats: Cat[] = [
    { key: 'buttons', icon: 'hand-pointer', render: () => (
      <div className="flex flex-wrap items-center gap-3">
        <WsButton icon="check">{DEMO.primary}</WsButton>
        <WsButton variant="secondary" icon="pen">{DEMO.secondary}</WsButton>
        <WsButton variant="ghost" icon="arrow-left">{DEMO.ghost}</WsButton>
        <WsButton variant="danger" icon="trash-can">{DEMO.danger}</WsButton>
        <WsButton icon="rotate" disabled>{DEMO.disabled}</WsButton>
        <div className="w-px h-6 bg-divider" />
        <IconButton icon="gear" /><IconButton icon="bell" active /><IconButton icon="ellipsis" />
      </div>
    ) },
    { key: 'selects', icon: 'caret-down', render: () => (
      <div className="flex flex-wrap items-start gap-4">
        <Field label="Dropdown · md"><Dropdown items={FRUIT} value={fruit} onChange={setFruit} size="md" /></Field>
        <Field label="Dropdown · lg · search"><Dropdown items={FRUIT} value={fruit} onChange={setFruit} size="lg" showSearch /></Field>
        <Field label="Multi-select"><MultiSelectDropdown items={TAGS} value={tags} onChange={setTags} selectedCountText={(n) => `${String(n)} selected`} size="md" /></Field>
      </div>
    ) },
    { key: 'inputs', icon: 'keyboard', render: () => (
      <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
        <TextField label="Text" value={text} onChange={setText} leftIcon={faMagnifyingGlass} clearable />
        <TextField type="number" label="Number" value={num} onChange={setNum} min={0} max={99} />
        <TextField type="password" label="Password" value="hunter2" onChange={() => { /* demo */ }} />
        <TextField type="search" label="Search" value={search} onChange={setSearch} placeholder="Type to filter…" />
        <div className="flex flex-col gap-3"><InputToggle checked={t1} onChange={setT1} label="Email notifications" /><InputToggle checked={t2} onChange={setT2} label="Compact mode" size="sm" /></div>
        <div className="flex flex-col gap-3"><Checkbox checked={c1} onChange={setC1} label="I agree to the terms" /><Checkbox checked={c2} onChange={setC2} label="Subscribe" indeterminate /></div>
        <DatePicker label="Due date" value={date} onChange={setDate} />
      </div>
    ) },
    { key: 'controls', icon: 'sliders', render: () => (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Segmented<'board' | 'list'> options={[{ id: 'board', label: 'Board' }, { id: 'list', label: 'List' }]} value={seg} onChange={setSeg} />
          <WsToggle on={wsT} onChange={setWsT} label="Workspace toggle" />
        </div>
        <div className="max-w-md"><Tabs tabs={[{ id: 'overview', label: 'Overview', icon: 'table-columns' }, { id: 'activity', label: 'Activity', icon: 'wave-square', count: 3 }, { id: 'settings', label: 'Settings', icon: 'gear' }]} active={tab} onChange={setTab} /></div>
      </div>
    ) },
    { key: 'overlays', icon: 'layer-group', render: () => (
      <div className="flex flex-wrap items-center gap-4">
        <BasePopover content={<div className="flex flex-col gap-1 text-sm text-common"><div className="font-medium text-title mb-1">{DEMO.signedIn}</div><button type="button" className="text-left hover:text-primary cursor-pointer">{DEMO.profile}</button><button type="button" className="text-left hover:text-primary cursor-pointer">{DEMO.signOut}</button></div>}>
          <WsButton variant="secondary" icon="caret-down">{DEMO.popover}</WsButton>
        </BasePopover>
        <PopMenu items={[{ label: 'Edit', icon: 'pen' }, { label: 'Duplicate', icon: 'copy' }, { divider: true }, { label: 'Delete', icon: 'trash-can', danger: true }]} triggerClass="inline-flex items-center gap-2 rounded-xl px-3.5 h-9 text-sm font-medium bg-container2 text-title hover:bg-container2-hover cursor-pointer" />
        <WsButton variant="secondary" icon="triangle-exclamation" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.designer.confirmDemoTitle' }), content: translate({ key: 'workspaces.designer.confirmDemoBody' }) }); }}>{translate({ key: 'workspaces.designer.openConfirm' })}</WsButton>
        <InfoDot title="Info dot" body={translate({ key: 'workspaces.designer.infoDotBody' })} align="left" />
      </div>
    ) },
    { key: 'data', icon: 'table-cells', render: () => (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">{ALL_STATUSES.map((s) => <StatusPill key={s} status={s} />)}</div>
        <div className="flex flex-wrap items-center gap-1.5">{DEMO_LABELS.map((l) => <LabelChip key={l} name={l} />)}</div>
        <div className="flex items-center gap-4"><AvatarStack users={DEMO_MEMBERS} max={3} size={28} /><div className="flex items-center gap-2">{DEMO_MEMBERS.slice(0, 3).map((m) => <AvatarBubble key={m.id} user={m} size={32} />)}</div></div>
        <EmptyState icon="inbox" title={translate({ key: 'workspaces.designer.emptyDemoTitle' })} sub={translate({ key: 'workspaces.designer.emptyDemoSub' })} action={<WsButton icon="plus">{DEMO.newItem}</WsButton>} />
      </div>
    ) },
    { key: 'states', icon: 'wand-sparkles', render: () => (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <WsButton icon="check">{DEMO.default}</WsButton>
          <WsButton icon="check" className="ring-2 ring-focus-ring">{DEMO.focus}</WsButton>
          <WsButton icon="spinner" className="[&_svg]:animate-spin">{DEMO.loading}</WsButton>
          <WsButton icon="check" disabled>{DEMO.disabled}</WsButton>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <input placeholder={DEMO.default} className={`${inputBase} border-container1-border focus:border-primary focus:ring-2 focus:ring-primary/30`} />
          <input placeholder={DEMO.focused} className={`${inputBase} border-primary ring-2 ring-primary/30`} />
          <input placeholder={DEMO.error} className={`${inputBase} border-wrong ring-2 ring-wrong/20`} />
          <input placeholder={DEMO.disabled} disabled className={`${inputBase} border-container1-border opacity-50 cursor-not-allowed`} />
        </div>
      </div>
    ) },
    { key: 'foundations', icon: 'ruler-combined', render: () => (
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted mb-2">{translate({ key: 'workspaces.designer.elevation' })}</div>
          <div className="flex flex-wrap items-end gap-3">{SHADOWS.map((sh) => <div key={sh} className={`w-16 h-16 rounded-xl bg-container1 border border-container1-border ${sh} flex items-end justify-center pb-1`}><span className="text-[9px] text-muted">{sh.replace('shadow', 'sh') || 'sh'}</span></div>)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted mb-2">{translate({ key: 'workspaces.designer.radiusScale' })}</div>
          <div className="flex flex-wrap items-center gap-3">{RADII.map((r) => <div key={r} className={`w-14 h-14 bg-primary/15 border border-primary/30 ${r}`} />)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted mb-2">{translate({ key: 'workspaces.designer.spacing' })}</div>
          <div className="flex items-end gap-2">{SPACES.map((sp) => <div key={sp} className="flex flex-col items-center gap-1"><div className="bg-primary rounded" style={{ width: sp, height: sp }} /><span className="text-[9px] text-muted font-mono">{sp}</span></div>)}</div>
        </div>
      </div>
    ) },
    { key: 'tokens', icon: 'palette', render: () => (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {COLOR_TOKENS.map((tk) => (
          <div key={tk} className="flex items-center gap-2 rounded-lg border border-container1-border bg-container1 p-2">
            <span className="w-8 h-8 rounded-md border border-container1-border shrink-0" style={{ backgroundColor: tokens[tk] }} />
            <div className="min-w-0"><div className="text-[11px] text-title truncate">{tk}</div><div className="text-[10px] text-muted font-mono truncate">{tokens[tk]}</div></div>
          </div>
        ))}
      </div>
    ) },
  ];

  const query = q.trim().toLowerCase();
  const shown = cats.filter((c) => (cat === 'all' || c.key === cat) && (query.length === 0 || translate({ key: `workspaces.designer.sec.${c.key}` }).toLowerCase().includes(query) || c.key.includes(query)));

  return (
    <div className="flex h-full min-h-0">
      {/* category rail */}
      <div className="w-48 shrink-0 border-r border-divider flex flex-col min-h-0 p-2 gap-1 overflow-y-auto">
        <div className="px-2 py-1.5"><input value={q} onChange={(e) => { setQ(e.target.value); }} placeholder={translate({ key: 'workspaces.designer.searchComponents' })} className="w-full h-8 px-2.5 rounded-lg border border-container1-border bg-container2/40 text-xs text-title focus:outline-none focus:border-primary" /></div>
        <CatBtn active={cat === 'all'} icon="grip" label={translate({ key: 'workspaces.designer.all' })} onClick={() => { setCat('all'); }} />
        {cats.map((c) => <CatBtn key={c.key} active={cat === c.key} icon={c.icon} label={translate({ key: `workspaces.designer.sec.${c.key}` })} onClick={() => { setCat(c.key); }} />)}
      </div>

      {/* theme-scoped canvas */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6">
        <div className="rounded-2xl border border-container1-border overflow-hidden" style={themeVars(tokens)}>
          <div className="bg-background text-common p-5 md:p-6 flex flex-col gap-5">
            {shown.length === 0 && <div className="text-sm text-muted py-8 text-center">{translate({ key: 'workspaces.designer.noMatch' })}</div>}
            {shown.map((c) => (
              <div key={c.key} className="rounded-xl border border-container1-border bg-container1 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-divider"><div className="text-sm font-semibold text-title">{translate({ key: `workspaces.designer.sec.${c.key}` })}</div><div className="text-xs text-muted">{translate({ key: `workspaces.designer.sec.${c.key}Sub` })}</div></div>
                <div className="p-4">{c.render()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CatBtn({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm cursor-pointer transition-colors ${active ? 'bg-container1 text-title ring-1 ring-primary/30' : 'text-common hover:bg-container1/60'}`}>
      <Icon name={icon} className={active ? 'text-primary' : 'text-muted'} /> <span className="truncate">{label}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[11px] text-muted">{label}</span>{children}</div>;
}
