//? Designer › Components — browse a curated showcase of the shared component kit, rendered LIVE under
//? the active theme. Reorganised from one long page into a category rail + search, so it stays scannable.

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
  const demo = {
    primary: translate({ key: 'workspaces.components.demoPrimary' }), secondary: translate({ key: 'workspaces.components.demoSecondary' }),
    ghost: translate({ key: 'workspaces.components.demoGhost' }), danger: translate({ key: 'workspaces.components.demoDanger' }),
    disabled: translate({ key: 'workspaces.components.demoDisabled' }), signedIn: translate({ key: 'workspaces.components.demoSignedIn' }),
    profile: translate({ key: 'workspaces.components.demoProfile' }), signOut: translate({ key: 'workspaces.components.demoSignOut' }),
    popover: translate({ key: 'workspaces.components.demoPopover' }), newItem: translate({ key: 'workspaces.components.demoNewItem' }),
    default: translate({ key: 'workspaces.components.demoDefault' }), focus: translate({ key: 'workspaces.components.demoFocus' }),
    loading: translate({ key: 'workspaces.components.demoLoading' }), focused: translate({ key: 'workspaces.components.demoFocused' }),
    error: translate({ key: 'workspaces.components.demoError' }), dropdownMd: translate({ key: 'workspaces.components.demoDropdownMd' }),
    dropdownSearch: translate({ key: 'workspaces.components.demoDropdownSearch' }), multiSelect: translate({ key: 'workspaces.components.demoMultiSelect' }),
    text: translate({ key: 'workspaces.components.demoText' }), number: translate({ key: 'workspaces.components.demoNumber' }),
    password: translate({ key: 'workspaces.components.demoPassword' }), search: translate({ key: 'workspaces.components.demoSearch' }),
    searchPlaceholder: translate({ key: 'workspaces.components.demoSearchPlaceholder' }), email: translate({ key: 'workspaces.components.demoEmailNotifications' }),
    compact: translate({ key: 'workspaces.components.demoCompactMode' }), agree: translate({ key: 'workspaces.components.demoAgreeTerms' }),
    subscribe: translate({ key: 'workspaces.components.demoSubscribe' }), dueDate: translate({ key: 'workspaces.components.demoDueDate' }),
    board: translate({ key: 'workspaces.components.demoBoard' }), list: translate({ key: 'workspaces.components.demoList' }),
    workspaceToggle: translate({ key: 'workspaces.components.demoWorkspaceToggle' }), overview: translate({ key: 'workspaces.components.demoOverview' }),
    activity: translate({ key: 'workspaces.components.demoActivity' }), settings: translate({ key: 'workspaces.components.demoSettings' }),
    edit: translate({ key: 'workspaces.components.demoEdit' }), duplicate: translate({ key: 'workspaces.components.demoDuplicate' }),
    delete: translate({ key: 'workspaces.components.demoDelete' }), infoDot: translate({ key: 'workspaces.components.demoInfoDot' }),
    apple: translate({ key: 'workspaces.components.demoApple' }), banana: translate({ key: 'workspaces.components.demoBanana' }),
    cherry: translate({ key: 'workspaces.components.demoCherry' }), frontend: translate({ key: 'workspaces.components.demoFrontend' }),
    backend: translate({ key: 'workspaces.components.demoBackend' }), design: translate({ key: 'workspaces.components.demoDesign' }),
  };
  const fruitItems: DropdownItem[] = [{ id: 'apple', value: 'apple', item: demo.apple }, { id: 'banana', value: 'banana', item: demo.banana }, { id: 'cherry', value: 'cherry', item: demo.cherry }];
  const tagItems: DropdownItem[] = [{ id: 1, value: 1, item: demo.frontend }, { id: 2, value: 2, item: demo.backend }, { id: 3, value: 3, item: demo.design }];

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
  const [fruit, setFruit] = useState<DropdownItem>(fruitItems[0]);
  const [tags, setTags] = useState<DropdownItem[]>([tagItems[0]]);
  const [date, setDate] = useState<Date | null>(null);

  const cats: Cat[] = [
    { key: 'buttons', icon: 'hand-pointer', render: () => (
      <div className="flex flex-wrap items-center gap-3">
        <WsButton icon="check">{demo.primary}</WsButton>
        <WsButton variant="secondary" icon="pen">{demo.secondary}</WsButton>
        <WsButton variant="ghost" icon="arrow-left">{demo.ghost}</WsButton>
        <WsButton variant="danger" icon="trash-can">{demo.danger}</WsButton>
        <WsButton icon="rotate" disabled>{demo.disabled}</WsButton>
        <div className="w-px h-6 bg-divider" />
        <IconButton icon="gear" /><IconButton icon="bell" active /><IconButton icon="ellipsis" />
      </div>
    ) },
    { key: 'selects', icon: 'caret-down', render: () => (
      <div className="flex flex-wrap items-start gap-4">
        <Field label={demo.dropdownMd}><Dropdown items={fruitItems} value={fruit} onChange={setFruit} size="md" /></Field>
        <Field label={demo.dropdownSearch}><Dropdown items={fruitItems} value={fruit} onChange={setFruit} size="lg" showSearch /></Field>
        <Field label={demo.multiSelect}><MultiSelectDropdown items={tagItems} value={tags} onChange={setTags} selectedCountText={(n) => translate({ key: 'workspaces.components.demoSelected', params: [{ key: 'n', value: String(n) }] })} size="md" /></Field>
      </div>
    ) },
    { key: 'inputs', icon: 'keyboard', render: () => (
      <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
        <TextField label={demo.text} value={text} onChange={setText} leftIcon={faMagnifyingGlass} clearable />
        <TextField type="number" label={demo.number} value={num} onChange={setNum} min={0} max={99} />
        <TextField type="password" label={demo.password} value="hunter2" onChange={() => { /* demo */ }} />
        <TextField type="search" label={demo.search} value={search} onChange={setSearch} placeholder={demo.searchPlaceholder} />
        <div className="flex flex-col gap-3"><InputToggle checked={t1} onChange={setT1} label={demo.email} /><InputToggle checked={t2} onChange={setT2} label={demo.compact} size="sm" /></div>
        <div className="flex flex-col gap-3"><Checkbox checked={c1} onChange={setC1} label={demo.agree} /><Checkbox checked={c2} onChange={setC2} label={demo.subscribe} indeterminate /></div>
        <DatePicker label={demo.dueDate} value={date} onChange={setDate} />
      </div>
    ) },
    { key: 'controls', icon: 'sliders', render: () => (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Segmented<'board' | 'list'> options={[{ id: 'board', label: demo.board }, { id: 'list', label: demo.list }]} value={seg} onChange={setSeg} />
          <WsToggle on={wsT} onChange={setWsT} label={demo.workspaceToggle} />
        </div>
        <div className="max-w-md"><Tabs tabs={[{ id: 'overview', label: demo.overview, icon: 'table-columns' }, { id: 'activity', label: demo.activity, icon: 'wave-square', count: 3 }, { id: 'settings', label: demo.settings, icon: 'gear' }]} active={tab} onChange={setTab} /></div>
      </div>
    ) },
    { key: 'overlays', icon: 'layer-group', render: () => (
      <div className="flex flex-wrap items-center gap-4">
        <BasePopover content={<div className="flex flex-col gap-1 text-sm text-common"><div className="font-medium text-title mb-1">{demo.signedIn}</div><button type="button" className="text-left hover:text-primary cursor-pointer">{demo.profile}</button><button type="button" className="text-left hover:text-primary cursor-pointer">{demo.signOut}</button></div>}>
          <WsButton variant="secondary" icon="caret-down">{demo.popover}</WsButton>
        </BasePopover>
        <PopMenu items={[{ label: demo.edit, icon: 'pen' }, { label: demo.duplicate, icon: 'copy' }, { divider: true }, { label: demo.delete, icon: 'trash-can', danger: true }]} triggerClass="inline-flex items-center gap-2 rounded-xl px-3.5 h-9 text-sm font-medium bg-container2 text-title hover:bg-container2-hover cursor-pointer" />
        <WsButton variant="secondary" icon="triangle-exclamation" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.designer.confirmDemoTitle' }), content: translate({ key: 'workspaces.designer.confirmDemoBody' }) }); }}>{translate({ key: 'workspaces.designer.openConfirm' })}</WsButton>
        <InfoDot title={demo.infoDot} body={translate({ key: 'workspaces.designer.infoDotBody' })} align="left" />
      </div>
    ) },
    { key: 'data', icon: 'table-cells', render: () => (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">{ALL_STATUSES.map((s) => <StatusPill key={s} status={s} />)}</div>
        <div className="flex flex-wrap items-center gap-1.5">{DEMO_LABELS.map((l) => <LabelChip key={l} name={l} />)}</div>
        <div className="flex items-center gap-4"><AvatarStack users={DEMO_MEMBERS} max={3} size={28} /><div className="flex items-center gap-2">{DEMO_MEMBERS.slice(0, 3).map((m) => <AvatarBubble key={m.id} user={m} size={32} />)}</div></div>
        <EmptyState icon="inbox" title={translate({ key: 'workspaces.designer.emptyDemoTitle' })} sub={translate({ key: 'workspaces.designer.emptyDemoSub' })} action={<WsButton icon="plus">{demo.newItem}</WsButton>} />
      </div>
    ) },
    { key: 'states', icon: 'wand-sparkles', render: () => (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <WsButton icon="check">{demo.default}</WsButton>
          <WsButton icon="check" className="ring-2 ring-focus-ring">{demo.focus}</WsButton>
          <WsButton icon="spinner" className="[&_svg]:animate-spin">{demo.loading}</WsButton>
          <WsButton icon="check" disabled>{demo.disabled}</WsButton>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <input placeholder={demo.default} className={`${inputBase} border-container1-border focus:border-primary focus:ring-2 focus:ring-primary/30`} />
          <input placeholder={demo.focused} className={`${inputBase} border-primary ring-2 ring-primary/30`} />
          <input placeholder={demo.error} className={`${inputBase} border-wrong ring-2 ring-wrong/20`} />
          <input placeholder={demo.disabled} disabled className={`${inputBase} border-container1-border opacity-50 cursor-not-allowed`} />
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
