//? Studio — the central brand library panel (ADR 0013 G-MKT-2), shown as the secondary "Brand" tab
//? on /studio. Palette + fonts + voice + taglines seed every generation; export/import (#164) lives
//? behind the footer overflow menu (rare actions off the first paint).

import { useEffect, useState } from 'react';

import { apiRequest, i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Icon from '../../_components/Icon';
import { PopMenu, WsButton } from '../../_components/primitives';
import { BrandLayerNote } from '../brandLayers';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { inputCls } from './content';
import { useWorkspaceTimeZone } from '../../_functions/wsTime';

//? #164 — paste a portable brand-kit JSON (from another workspace's Export) to import it. Rendered in
//? the menuHandler overlay; on success it refetches so the imported palette/voice/taglines show.
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
        <WsButton icon="check" disabled={busy || kit.trim().length === 0} onClick={submit}>{translate({ key: 'workspaces.studio.brandImportAction' })}</WsButton>
      </div>
    </div>
  );
}

export function BrandPanel() {
  const translate = useTranslator();
  const { studioBrand, saveBrand, activeWorkspace, refetch, focusSetup } = useWorkspaces();
  //? D55 — the provenance date is a workspace fact, read in the workspace's own zone.
  const timeZone = useWorkspaceTimeZone();
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
    //? ADR 0310 — the server stamps provenance ('manual' here) inside the same write, so it is durable
    //? and visible to teammates instead of only to the browser that made the edit.
    setSaving(false);
  };
  const setColor = (i: number, patch: Partial<{ name: string; hex: string }>) => { setPalette((p) => p.map((c, j) => (j === i ? { ...c, ...patch } : c))); };
  //? ADR 0310 — provenance now comes from the record itself (StudioBrandLibrary.lastSetFrom/At).
  const provenance = studioBrand?.lastSetFrom !== undefined && studioBrand.lastSetFrom.length > 0
    ? { source: studioBrand.lastSetFrom, at: studioBrand.lastSetAt ?? '' }
    : null;

  return (
    <div className={`p-4 md:p-6 max-w-2xl flex flex-col gap-5`}>
      <div>
        <div className={`text-xl font-semibold text-title`}>{translate({ key: 'workspaces.studio.brandLibrary' })}</div>
        <div className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.studio.brandIntro' })}</div>
        <BrandLayerNote surface="studio" onOpen={() => { focusSetup({ view: 'content/settings', tab: 'brand' }); }} />
        {/* ADR 0310 — provenance, shown wherever the workspace is opened (not just where it was set). */}
        {provenance && (
          <div className={`text-xs text-meta mt-1`}>
            {translate({
              key: 'workspaces.studio.brandProvenanceLabel',
              params: [
                { key: 'source', value: provenance.source === 'manual' ? translate({ key: 'workspaces.studio.brandProvenanceManual' }) : provenance.source },
                { key: 'date', value: provenance.at.length > 0 ? new Date(provenance.at).toLocaleDateString(undefined, { timeZone }) : '' },
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
          {palette.map((c, i) => {
            const swatchLabel = c.name.trim().length > 0 ? c.name : String(i + 1);
            return (
              // eslint-disable-next-line react-x/no-array-index-key -- an editable positional list; a value-key would lose input focus on edit
              <div key={i} className={`flex flex-wrap items-center gap-2`}>
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : '#000000'} onChange={(e) => { setColor(i, { hex: e.target.value }); }} aria-label={translate({ key: 'workspaces.studio.colourSwatch', params: [{ key: 'name', value: swatchLabel }] })} className={`w-9 h-9 rounded-lg border border-container1-border cursor-pointer bg-transparent p-0.5`} />
                <input value={c.name} onChange={(e) => { setColor(i, { name: e.target.value }); }} placeholder={translate({ key: 'workspaces.studio.colourName' })} className={`flex-1 min-w-28 ${inputCls}`} />
                <input value={c.hex} onChange={(e) => { setColor(i, { hex: e.target.value }); }} placeholder="#4B3FDE" className={`w-28 font-mono ${inputCls}`} />
                <button type="button" onClick={() => { setPalette((p) => p.filter((_, j) => j !== i)); }} aria-label={translate({ key: 'workspaces.studio.removeColour' })} className={`text-muted hover:text-wrong cursor-pointer shrink-0`}><Icon name="trash" className={`text-xs`} /></button>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3`}>
        <div className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.fontHeading' })}</span><input value={heading} onChange={(e) => { setHeading(e.target.value); }} placeholder="Sora" className={inputCls} /></div>
        <div className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.fontBody' })}</span><input value={body} onChange={(e) => { setBody(e.target.value); }} placeholder="Inter" className={inputCls} /></div>
      </div>
      <div className={`flex flex-col gap-1`}>
        <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.voice' })}</span>
        <textarea value={voice} onChange={(e) => { setVoice(e.target.value); }} rows={3} placeholder={translate({ key: 'workspaces.studio.voicePlaceholder' })} className={`${inputCls} h-auto py-2 resize-y`} />
        {/* IA-conflict finding — this is workspace-wide and only a fallback; say so, since nothing else does. */}
        <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.voicePrecedenceHint' })}</span>
      </div>
      <div className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.taglinesOnePerLine' })}</span><textarea value={taglines} onChange={(e) => { setTaglines(e.target.value); }} rows={3} className={`${inputCls} h-auto py-2 resize-y`} /></div>

      <div className={`flex flex-wrap items-center justify-between gap-2 pt-1`}>
        <div className={`text-xs text-muted flex items-center gap-1.5`}><Icon name="wand-magic-sparkles" className={`text-primary`} />{translate({ key: 'workspaces.studio.brandTip' })}</div>
        <div className={`flex items-center gap-2`}>
          {/* #164 — export (copy JSON) + import (paste JSON) are rare: they live behind the overflow menu */}
          <PopMenu
            ariaLabel={translate({ key: 'workspaces.studio.brandActions' })}
            items={[
              { icon: 'copy', label: translate({ key: 'workspaces.studio.brandExport' }), onClick: exportBrand },
              { icon: 'file-lines', label: translate({ key: 'workspaces.studio.brandImport' }), onClick: importBrand },
            ]}
          />
          <WsButton icon="check" onClick={() => { void save(); }} disabled={saving}>{translate({ key: 'workspaces.studio.saveBrand' })}</WsButton>
        </div>
      </div>
    </div>
  );
}
