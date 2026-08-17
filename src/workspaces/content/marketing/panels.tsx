//? Marketing — drill-in panels (KISS fork of the shared Studio surface's forms; /studio keeps its
//? own in ../studio/page.tsx). BriefForm creates/edits the product brief; BrandPanel is the brand
//? library (palette/fonts/voice/taglines + portable kit export/import). Ops are identical to the
//? studio originals — only where they live on screen changed (drill-ins instead of a left rail).

import { useEffect, useState } from 'react';

import { apiRequest, i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Icon from '../../_components/Icon';
import { Disclosure, IconButton, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { StudioBrief } from '../../_data/types';
import { getBrandProvenance, recordBrandProvenance } from '../studio/brandProvenance';

const inputCls = 'w-full h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

//? ---- Brief form (create + edit flow through the same form; canSave = name AND productName) ----
export function BriefForm({ brief, onSaved, onCancel }: { brief: StudioBrief | null; onSaved: () => void; onCancel?: () => void }) {
  const translate = useTranslator();
  const { saveBrief } = useWorkspaces();
  const [name, setName] = useState(brief?.name ?? '');
  const [productName, setProductName] = useState(brief?.productName ?? '');
  const [audience, setAudience] = useState(brief?.audience ?? '');
  const [tone, setTone] = useState(brief?.tone ?? '');
  const [goals, setGoals] = useState(brief?.goals ?? '');
  const [notes, setNotes] = useState(brief?.notes ?? '');
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

  return (
    <div className={`flex flex-col gap-4`}>
      <div className={`text-lg font-semibold text-title`}>{translate({ key: brief ? 'workspaces.studio.editBrief' : 'workspaces.studio.newBrief' })}</div>
      <div className={`text-sm text-muted -mt-2`}>{translate({ key: 'workspaces.studio.briefIntro' })}</div>
      {/* required pair: name + product carry equal weight, side by side so the form reads in two rows, not six */}
      <div className={`grid sm:grid-cols-2 gap-3`}>
        {field(translate({ key: 'workspaces.studio.fieldName' }), name, setName, translate({ key: 'workspaces.studio.fieldNamePlaceholder' }))}
        {field(translate({ key: 'workspaces.studio.fieldProduct' }), productName, setProductName, translate({ key: 'workspaces.studio.fieldProductPlaceholder' }))}
      </div>
      <div className={`grid sm:grid-cols-2 gap-3`}>
        {field(translate({ key: 'workspaces.studio.fieldAudience' }), audience, setAudience, translate({ key: 'workspaces.studio.fieldAudiencePlaceholder' }))}
        {field(translate({ key: 'workspaces.studio.fieldTone' }), tone, setTone, translate({ key: 'workspaces.studio.fieldTonePlaceholder' }))}
      </div>
      {/* optional (canSave only needs name+productName) — collapsed behind a disclosure instead of two more full-weight rows */}
      <Disclosure summary={translate({ key: 'workspaces.studio.optionalDetails' })}>
        <div className={`flex flex-col gap-4`}>
          {field(translate({ key: 'workspaces.studio.fieldGoals' }), goals, setGoals, translate({ key: 'workspaces.studio.fieldGoalsPlaceholder' }), true)}
          {field(translate({ key: 'workspaces.studio.fieldNotes' }), notes, setNotes, translate({ key: 'workspaces.studio.fieldNotesPlaceholder' }), true)}
        </div>
      </Disclosure>
      <div className={`flex items-center justify-end gap-2 pt-1`}>
        {onCancel && <WsButton variant="ghost" onClick={onCancel}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>}
        <WsButton icon="check" onClick={() => { void save(); }} disabled={!canSave || saving}>{translate({ key: 'workspaces.studio.saveBrief' })}</WsButton>
      </div>
    </div>
  );
}

//? ---- Central brand library panel (ADR 0013 G-MKT-2) ----
//? #164 — paste a portable brand-kit JSON (from another workspace's Export) to import it. Rendered in
//? the menuHandler overlay — which mounts ABOVE WorkspacesProvider (lesson 0011), so workspaceId comes
//? in via props, never via useWorkspaces().
function BrandImportForm({ workspaceId, onImported }: { workspaceId: string; onImported: () => void }) {
  const translate = useTranslator();
  const [kit, setKit] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (busy || kit.trim().length === 0) return;
    setBusy(true);
    void apiRequest({ name: 'workspaces/brandImport', version: 'v1', data: { workspaceId, kit: kit.trim() } }).then((r) => {
      setBusy(false);
      if (r.status === 'success') { notify.success({ key: 'workspaces.studio.brandImported' }); void menuHandler.close(); onImported(); }
      else notify.error({ key: 'workspaces.studio.brandImportFailed' });
    });
  };
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.studio.brandImportTitle' })}</div>
      <textarea value={kit} onChange={(e) => { setKit(e.target.value); }} rows={8} placeholder={translate({ key: 'workspaces.studio.brandImportPlaceholder' })} className={`${inputCls} h-auto py-2 font-mono resize-y`} />
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="file-import" disabled={busy || kit.trim().length === 0} onClick={submit}>{translate({ key: 'workspaces.studio.brandImportAction' })}</WsButton>
      </div>
    </div>
  );
}

export function BrandPanel() {
  const translate = useTranslator();
  const { studioBrand, saveBrand, activeWorkspace, refetch } = useWorkspaces();
  //? #164 — portable brand-kit export (copy JSON to clipboard) + import (paste JSON).
  const exportBrand = () => {
    void apiRequest({ name: 'workspaces/brandExport', version: 'v1', data: { workspaceId: activeWorkspace.id } }).then((r) => {
      if (r.status !== 'success' || r.result.kit.length === 0) { notify.error({ key: 'workspaces.studio.brandExportEmpty' }); return; }
      void navigator.clipboard.writeText(r.result.kit).then(() => { notify.success({ key: 'workspaces.studio.brandExported' }); }, () => { notify.error({ key: 'workspaces.studio.brandExportFailed' }); });
    });
  };
  const importBrand = () => { void menuHandler.open(<BrandImportForm workspaceId={activeWorkspace.id} onImported={refetch} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };
  const [palette, setPalette] = useState<{ name: string; hex: string }[]>(studioBrand?.palette ?? []);
  const [heading, setHeading] = useState(studioBrand?.typography.heading ?? '');
  const [body, setBody] = useState(studioBrand?.typography.body ?? '');
  const [voice, setVoice] = useState(studioBrand?.voice ?? '');
  const [taglines, setTaglines] = useState((studioBrand?.taglines ?? []).join('\n'));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPalette(studioBrand?.palette ?? []);
    setHeading(studioBrand?.typography.heading ?? '');
    setBody(studioBrand?.typography.body ?? '');
    setVoice(studioBrand?.voice ?? '');
    setTaglines((studioBrand?.taglines ?? []).join('\n'));
  }, [studioBrand]);

  const save = async () => {
    setSaving(true);
    await saveBrand({ palette: palette.filter((p) => p.hex.trim().length > 0), typography: { heading: heading.trim(), body: body.trim() }, voice: voice.trim(), taglines: taglines.split('\n').map((t) => t.trim()).filter(Boolean) });
    //? Owner decision 6 — provenance covers manual edits too, not only "Use as brand" promotions.
    recordBrandProvenance(activeWorkspace.id, 'manual');
    setSaving(false);
  };
  const setColor = (i: number, patch: Partial<{ name: string; hex: string }>) => { setPalette((p) => p.map((c, j) => (j === i ? { ...c, ...patch } : c))); };
  const provenance = getBrandProvenance(activeWorkspace.id);

  return (
    <div className={`flex flex-col gap-5`}>
      <div>
        <div className={`text-xl font-semibold text-title`}>{translate({ key: 'workspaces.studio.brandLibrary' })}</div>
        <div className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.studio.brandIntro' })}</div>
        {/* Owner decision 6 — provenance; only shown once this browser has recorded one. */}
        {provenance && (
          <div className={`text-xs text-meta mt-1`}>
            {translate({
              key: 'workspaces.studio.brandProvenanceLabel',
              params: [
                { key: 'source', value: provenance.source === 'manual' ? translate({ key: 'workspaces.studio.brandProvenanceManual' }) : provenance.source },
                { key: 'date', value: new Date(provenance.at).toLocaleDateString() },
              ],
            })}
          </div>
        )}
      </div>

      {/* palette editor */}
      <div>
        <div className={`flex items-center justify-between mb-2`}><span className={`text-sm font-medium text-title`}>{translate({ key: 'workspaces.studio.palette' })}</span>
          <button type="button" onClick={() => { setPalette((p) => [...p, { name: '', hex: '#6366F1' }]); }} className={`text-xs text-primary hover:text-primary-hover cursor-pointer flex items-center gap-1`}><Icon name="plus" className={`text-xs`} />{translate({ key: 'workspaces.studio.addColour' })}</button>
        </div>
        <div className={`flex flex-col gap-2`}>
          {palette.length === 0 && <div className={`text-sm text-muted`}>{translate({ key: 'workspaces.studio.brandEmptyPalette' })}</div>}
          {palette.map((c, i) => (
            // eslint-disable-next-line react-x/no-array-index-key -- an editable positional list; a value-key would lose input focus on edit
            <div key={i} className={`flex items-center gap-2`}>
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : '#000000'} onChange={(e) => { setColor(i, { hex: e.target.value }); }} className={`w-9 h-9 rounded-lg border border-container1-border cursor-pointer bg-transparent p-0.5`} />
              <input value={c.name} onChange={(e) => { setColor(i, { name: e.target.value }); }} placeholder={translate({ key: 'workspaces.studio.colourName' })} className={`flex-1 ${inputCls}`} />
              <input value={c.hex} onChange={(e) => { setColor(i, { hex: e.target.value }); }} placeholder="#4B3FDE" className={`w-28 font-mono ${inputCls}`} />
              <IconButton icon="trash-can" title={translate({ key: 'workspaces.studio.removeColour' })} onClick={() => { setPalette((p) => p.filter((_, j) => j !== i)); }} className={`shrink-0 hover:text-wrong`} />
            </div>
          ))}
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-3`}>
        <div className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.fontHeading' })}</span><input value={heading} onChange={(e) => { setHeading(e.target.value); }} placeholder="Sora" className={inputCls} /></div>
        <div className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.fontBody' })}</span><input value={body} onChange={(e) => { setBody(e.target.value); }} placeholder="Inter" className={inputCls} /></div>
      </div>
      <div className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.voice' })}</span><textarea value={voice} onChange={(e) => { setVoice(e.target.value); }} rows={3} placeholder={translate({ key: 'workspaces.studio.voicePlaceholder' })} className={`${inputCls} h-auto py-2 resize-y`} /></div>
      <div className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.taglinesOnePerLine' })}</span><textarea value={taglines} onChange={(e) => { setTaglines(e.target.value); }} rows={3} className={`${inputCls} h-auto py-2 resize-y`} /></div>

      <div className={`flex flex-wrap items-center justify-between gap-2 pt-1`}>
        <div className={`text-xs text-muted flex items-center gap-1.5`}><Icon name="wand-magic-sparkles" className={`text-primary`} />{translate({ key: 'workspaces.studio.brandTip' })}</div>
        <div className={`flex items-center gap-2`}>
          {/* #164 — portable brand-kit export (copy JSON) + import (paste JSON). */}
          <WsButton variant="ghost" icon="file-export" onClick={exportBrand}>{translate({ key: 'workspaces.studio.brandExport' })}</WsButton>
          <WsButton variant="ghost" icon="file-import" onClick={importBrand}>{translate({ key: 'workspaces.studio.brandImport' })}</WsButton>
          <WsButton icon="check" onClick={() => { void save(); }} disabled={saving}>{translate({ key: 'workspaces.studio.saveBrand' })}</WsButton>
        </div>
      </div>
    </div>
  );
}
