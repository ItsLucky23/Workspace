//? Designer — small shared UI bits reused across the sections (Components / Styles / Animations /
//? Themes / Typography): an inline rename field, a source badge (built-in / AI / custom), a section
//? header, the responsive library rail, and the shared input class. Kept tiny + presentational.

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { PopMenu, type PopMenuItem } from '../../_components/primitives';
import { FONT_LIBRARY, fontByStack } from './fonts';

export { INPUT_CLS_FULL as inputCls } from '../../_components/settings';

//? Inline rename: double-click the name (or click the pencil) to edit — a SINGLE click passes
//? through so a parent row can still select. Enter/blur saves, Esc cancels.
export function RenameField({ value, onRename, className = '' }: { value: string; onRename: (name: string) => void; className?: string }) {
  const translate = useTranslator();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(value); ref.current?.focus(); ref.current?.select(); } }, [editing, value]);
  const commit = () => { const n = draft.trim(); if (n.length > 0 && n !== value) onRename(n); setEditing(false); };
  if (editing) {
    return (
      <input ref={ref} value={draft} onClick={(e) => { e.stopPropagation(); }} onChange={(e) => { setDraft(e.target.value); }} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className={`h-7 px-1.5 rounded-md border border-primary bg-container1 text-sm text-title focus:outline-none ${className}`} />
    );
  }
  return (
    <span onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }} title={translate({ key: 'workspaces.designer.rename' })}
      className={`group/rn inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <span className="truncate">{value}</span>
      <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="text-[10px] text-muted opacity-0 pointer-coarse:opacity-100 group-hover/rn:opacity-100 shrink-0 cursor-pointer hover:text-primary"><Icon name="pen" /></button>
    </span>
  );
}

export function SourceBadge({ source }: { source: 'seed' | 'ai' | 'manual' }) {
  const translate = useTranslator();
  const meta = source === 'seed'
    ? { icon: 'star', tint: 'bg-container2 text-muted' }
    : (source === 'ai' ? { icon: 'wand-magic-sparkles', tint: 'bg-primary/12 text-primary' } : { icon: 'pen', tint: 'bg-container2 text-common' });
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tint}`}><Icon name={meta.icon} className="text-[10px]" />{translate({ key: `workspaces.designer.source.${source}` })}</span>;
}

//? A section title + subtitle + optional right-hand actions row. `title` accepts a node so a section
//? can put its RenameField in the heading (the phone-width rename surface once the rail collapses).
export function SectionHead({ icon, title, sub, right }: { icon: string; title: ReactNode; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="w-8 h-8 shrink-0 rounded-xl bg-primary/12 text-primary flex items-center justify-center"><Icon name={icon} /></span>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-title">{title}</div>
          <div className="text-sm text-muted">{sub}</div>
        </div>
      </div>
      {right}
    </div>
  );
}

//? The shared library rail for Themes / Styles / Animations. On ≥md: the classic w-64 list (inline
//? rename, per-row actions behind a PopMenu, "+ New" pinned at the bottom). On phone the fixed rail
//? was the main width problem (it squeezed the editor), so it collapses to a Dropdown picker + ONE
//? actions menu (the active item's actions + "+ New"); renaming happens in the editor's heading.
export interface LibraryRailItem { id: string; name: string; source: 'seed' | 'ai' | 'manual' }
export function LibraryRail<T extends LibraryRailItem>({ title, sub, addLabel, menuLabel, items, activeId, onSelect, onRename, onAdd, menuFor, rowLeft, rowBelow }: {
  title: string; sub: string; addLabel: string; menuLabel: string;
  items: T[]; activeId: string;
  onSelect: (id: string) => void; onRename: (id: string, name: string) => void; onAdd: () => void;
  menuFor: (item: T) => PopMenuItem[];
  rowLeft?: (item: T) => ReactNode; rowBelow?: (item: T) => ReactNode;
}) {
  const ddItems: DropdownItem[] = items.map((it) => ({ id: it.id, value: it.id, item: it.name }));
  const activeDd = ddItems.find((i) => i.id === activeId);
  const active = items.find((i) => i.id === activeId);
  const activeMenu = active ? menuFor(active) : [];
  const addItem: PopMenuItem = { label: addLabel, icon: 'plus', onClick: onAdd };
  const phoneMenu: PopMenuItem[] = activeMenu.length > 0 ? [...activeMenu, { divider: true }, addItem] : [addItem];
  return (
    <>
      {/* phone: picker + one actions menu instead of the fixed rail */}
      <div className={`md:hidden shrink-0 border-b border-divider px-3 py-2 flex items-center gap-2`}>
        <div className={`flex-1 min-w-0`}>
          <Dropdown items={ddItems} {...(activeDd ? { value: activeDd } : {})} onChange={(i) => { onSelect(String(i.id)); }} size="md" />
        </div>
        <PopMenu ariaLabel={menuLabel} items={phoneMenu} />
      </div>
      {/* ≥md: the classic rail */}
      <div className={`hidden md:flex w-64 shrink-0 border-r border-divider flex-col min-h-0`}>
        <div className={`px-4 pt-4 pb-2 shrink-0`}>
          <div className={`text-sm font-semibold text-title`}>{title}</div>
          <div className={`text-xs text-muted mt-0.5`}>{sub}</div>
        </div>
        <div className={`flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1`}>
          {items.map((it) => {
            const menu = menuFor(it);
            return (
              <div key={it.id} onClick={() => { onSelect(it.id); }} className={`group rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${it.id === activeId ? 'bg-container1 ring-1 ring-primary/40' : 'hover:bg-container1/60'}`}>
                <div className={`flex items-center gap-2`}>
                  {rowLeft?.(it)}
                  <RenameField value={it.name} onRename={(n) => { onRename(it.id, n); }} className={`flex-1 min-w-0 text-sm text-title`} />
                  {menu.length > 0 && <PopMenu ariaLabel={menuLabel} items={menu} />}
                </div>
                {rowBelow?.(it)}
              </div>
            );
          })}
        </div>
        <div className={`shrink-0 border-t border-divider p-2`}>
          <button type="button" onClick={onAdd} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-common hover:bg-container2 cursor-pointer`}><Icon name="plus" className={`text-muted`} /> {addLabel}</button>
        </div>
      </div>
    </>
  );
}

//? Font picker — each option renders in its own typeface so you can compare at a glance. Selecting
//? one writes its font stack; a hand-typed custom stack simply shows as "Custom" until changed.
const FONT_ITEMS: DropdownItem[] = FONT_LIBRARY.map((f) => ({ id: f.id, value: f.id, searchText: f.name, item: <span style={{ fontFamily: f.stack }}>{f.name}</span>, selectedItem: <span style={{ fontFamily: f.stack }} className="truncate">{f.name}</span> }));
export function FontPicker({ label, value, onChange }: { label: string; value: string; onChange: (stack: string) => void }) {
  const translate = useTranslator();
  const current = fontByStack(value);
  const activeItem = current ? FONT_ITEMS.find((i) => i.id === current.id) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      <Dropdown items={FONT_ITEMS} {...(activeItem ? { value: activeItem } : {})} placeholder={translate({ key: 'workspaces.designer.customFont' })} showSearch size="lg"
        onChange={(item) => { const f = FONT_LIBRARY.find((x) => x.id === item.id); if (f) onChange(f.stack); }} />
    </div>
  );
}

//? A small labelled slider used by the Styles + Animations editors.
export function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[11px] text-muted"><span>{label}</span><span className="font-mono text-common">{value}{unit}</span></span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => { onChange(Number(e.target.value)); }} className="w-full accent-primary cursor-pointer" />
    </div>
  );
}
