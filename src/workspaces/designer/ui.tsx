//? Designer — small shared UI bits reused across the sections (Components / Styles / Animations /
//? Themes / Typography): an inline rename field, a source badge (built-in / AI / custom), a section
//? header, and the shared input class. Kept tiny + presentational.

import { useEffect, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';

export const inputCls = 'w-full h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

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
      <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="text-[10px] text-muted opacity-0 group-hover/rn:opacity-100 shrink-0 cursor-pointer hover:text-primary"><Icon name="pen" /></button>
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

//? A section title + subtitle + optional right-hand actions row.
export function SectionHead({ icon, title, sub, right }: { icon: string; title: string; sub: string; right?: React.ReactNode }) {
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

//? A small labelled slider used by the Styles + Animations editors.
export function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[11px] text-muted"><span>{label}</span><span className="font-mono text-common">{value}{unit}</span></span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => { onChange(Number(e.target.value)); }} className="w-full accent-primary cursor-pointer" />
    </div>
  );
}
