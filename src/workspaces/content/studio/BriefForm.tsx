//? Studio + Marketing — the ONE product-brief form (F-005/F-020: marketing/panels.tsx carried a
//? hand-forked copy that had already lost the duplicate-from picker). Create + edit flow through the
//? same form; canSave = name AND productName. `compact` drops the page padding for a drill-in host
//? that supplies its own.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import { SectionCard, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { StudioBrief } from '../../_data/types';
import { inputCls } from './content';

export interface BriefDraft { name: string; productName: string; audience: string; tone: string; goals: string; notes: string }

//? `initial` (#109) seeds a NEW brief from a copilot prefill; the user reviews + saves themselves.
export function BriefForm({ brief, initial, onSaved, onCancel, compact = false }: { brief: StudioBrief | null; initial?: BriefDraft; onSaved: () => void; onCancel?: () => void; compact?: boolean }) {
  const translate = useTranslator();
  const { saveBrief, studioBriefs } = useWorkspaces();
  const [name, setName] = useState(brief?.name ?? initial?.name ?? '');
  const [productName, setProductName] = useState(brief?.productName ?? initial?.productName ?? '');
  const [audience, setAudience] = useState(brief?.audience ?? initial?.audience ?? '');
  const [tone, setTone] = useState(brief?.tone ?? initial?.tone ?? '');
  const [goals, setGoals] = useState(brief?.goals ?? initial?.goals ?? '');
  const [notes, setNotes] = useState(brief?.notes ?? initial?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const canSave = name.trim().length > 0 && productName.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    await saveBrief({ ...(brief ? { id: brief.id } : {}), name: name.trim(), productName: productName.trim(), audience: audience.trim(), tone: tone.trim(), goals: goals.trim(), notes: notes.trim() });
    setSaving(false);
    onSaved();
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, area = false) => (
    <div className={`flex flex-col gap-1`}>
      <span className={`text-xs text-muted`}>{label}</span>
      {area
        ? <textarea value={value} onChange={(e) => { set(e.target.value); }} placeholder={placeholder} rows={3} className={`${inputCls} h-auto py-2 resize-y`} />
        : <input value={value} onChange={(e) => { set(e.target.value); }} placeholder={placeholder} className={inputCls} />}
    </div>
  );

  //? "flat stack of 6 identical rows" finding — a second/third brief re-typed everything from a blank
  //? page every time. Offered only on a brand-new brief (not edit) when a brief already exists to copy.
  const duplicateItems: DropdownItem[] = studioBriefs.map((b) => ({ id: b.id, value: b.id, item: `${b.name} — ${b.productName}` }));
  const applyDuplicate = (id: string) => {
    const source = studioBriefs.find((b) => b.id === id);
    if (!source) return;
    setName(source.name); setProductName(source.productName); setAudience(source.audience); setTone(source.tone); setGoals(source.goals); setNotes(source.notes ?? '');
  };

  return (
    <div className={`${compact ? '' : 'p-4 md:p-6 '}max-w-2xl flex flex-col gap-4`}>
      <div className={`text-lg font-semibold text-title`}>{translate({ key: brief ? 'workspaces.studio.editBrief' : 'workspaces.studio.newBrief' })}</div>
      <div className={`text-sm text-muted -mt-2`}>{translate({ key: 'workspaces.studio.briefIntro' })}</div>
      {!brief && studioBriefs.length > 0 && (
        <div className={`flex flex-col gap-1`}>
          <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.duplicateFromLabel' })}</span>
          <Dropdown width="full" items={duplicateItems} placeholder={translate({ key: 'workspaces.studio.duplicateFromPlaceholder' })} onChange={(it) => { applyDuplicate(String(it.id)); }} />
        </div>
      )}
      {/* grouped into two visually distinct clusters instead of six identical label+input rows */}
      <SectionCard title={translate({ key: 'workspaces.studio.identitySection' })}>
        <div className={`flex flex-col gap-4`}>
          {field(translate({ key: 'workspaces.studio.fieldName' }), name, setName, translate({ key: 'workspaces.studio.fieldNamePlaceholder' }))}
          {field(translate({ key: 'workspaces.studio.fieldProduct' }), productName, setProductName, translate({ key: 'workspaces.studio.fieldProductPlaceholder' }))}
        </div>
      </SectionCard>
      <SectionCard title={translate({ key: 'workspaces.studio.targetingSection' })}>
        <div className={`flex flex-col gap-4`}>
          {field(translate({ key: 'workspaces.studio.fieldAudience' }), audience, setAudience, translate({ key: 'workspaces.studio.fieldAudiencePlaceholder' }))}
          {field(translate({ key: 'workspaces.studio.fieldTone' }), tone, setTone, translate({ key: 'workspaces.studio.fieldTonePlaceholder' }))}
        </div>
      </SectionCard>
      {field(translate({ key: 'workspaces.studio.fieldGoals' }), goals, setGoals, translate({ key: 'workspaces.studio.fieldGoalsPlaceholder' }), true)}
      {field(translate({ key: 'workspaces.studio.fieldNotes' }), notes, setNotes, translate({ key: 'workspaces.studio.fieldNotesPlaceholder' }), true)}
      <div className={`flex items-center justify-end gap-2 pt-1`}>
        {onCancel && <WsButton variant="ghost" onClick={onCancel}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>}
        <WsButton icon="check" onClick={() => { void save(); }} disabled={!canSave || saving}>{translate({ key: 'workspaces.studio.saveBrief' })}</WsButton>
      </div>
    </div>
  );
}

