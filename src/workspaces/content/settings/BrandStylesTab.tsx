//? content/settings — Tab 1 "Brand & styles": the brand/product context card carries the page's PRIMARY
//? action (Q2 — the persistent brand description + logo folded into every AI generation), followed by the
//? style library (Q3, authoring in a dialog, export/import behind the overflow menu). The inspiration
//? references and output templates are style-adjacent but secondary → disclosures below.

import { useState } from 'react';

import { apiRequest, useTranslator, i18nNotify as notify } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { Disclosure, EmptyState, PopMenu, SectionCard, WsButton } from '../../_components/primitives';
import { SavePill, useAutosave, type SaveStatus } from '../../_components/settings';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { StyleEditorForm, StyleImportForm, type StyleDraft } from './portalForms';
import { fieldCls, mediaSrc } from './shared';

//? Q2 — the persistent brand/product context folded into EVERY creative generation. Saved via the
//? content-edit-product control-op. Until it is saved once, the card header TEACHES what this place is for.
function BrandContextCard() {
  const translate = useTranslator();
  const { activeWorkspace, saveProductContext, saveBrandLogo } = useWorkspaces();
  const hasSaved = (activeWorkspace.productContext ?? '').trim().length > 0;
  const [value, setValue] = useState(activeWorkspace.productContext ?? '');
  const status = useAutosave([value], () => { saveProductContext(value.trim()); }, { resetKey: activeWorkspace.id });
  //? The brand logo the render WATERMARK overlays (the ffmpeg overlay's logo source, not decoration).
  const [logoStatus, setLogoStatus] = useState<SaveStatus>('idle');
  return (
    <SectionCard
      title={translate({ key: hasSaved ? 'workspaces.content.brandContextTitle' : 'workspaces.content.brandEmptyTitle' })}
      desc={translate({ key: hasSaved ? 'workspaces.content.brandContextDesc' : 'workspaces.content.brandEmptySub' })}
    >
      <textarea
        value={value} onChange={(e) => { setValue(e.target.value); }} rows={4}
        placeholder={translate({ key: 'workspaces.content.brandContextPlaceholder' })}
        className={`w-full ${fieldCls} resize-none`}
      />
      <div className={`mt-3 flex flex-wrap items-center gap-3`}>
        <SavePill status={status} />
      </div>
      <div className={`mt-4 pt-3 border-t border-divider flex flex-wrap items-center justify-between gap-3`}>
        <span className={`text-sm text-common`} title={translate({ key: 'workspaces.content.brandLogoHint' })}>{translate({ key: 'workspaces.content.brandLogoLabel' })}</span>
        <div className={`flex items-center gap-2`}>
          <SavePill status={logoStatus} />
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.content.brandLogoUpload" icon="image" onUploaded={(url) => { saveBrandLogo(url); setLogoStatus('saved'); }} />
        </div>
      </div>
    </SectionCard>
  );
}

//? Q3 — the style library: read-only rows (builtins get a badge, no edit/delete), authoring in a dialog
//? behind ONE 'New style' button (edit pre-fills the same dialog, upsert-by-key). Export/import (#152)
//? are rare actions → the overflow menu on the header.
function StylesCard() {
  const translate = useTranslator();
  const { content, saveStyle, deleteStyle, activeWorkspace, refetch } = useWorkspaces();
  const exportStyles = () => {
    void apiRequest({ name: 'workspaces/styleExport', version: 'v1', data: { workspaceId: activeWorkspace.id } }).then((r) => {
      if (r.status !== 'success' || r.result.styles.length === 0) { notify.error({ key: 'workspaces.content.styleExportEmpty' }); return; }
      void navigator.clipboard.writeText(r.result.styles).then(() => { notify.success({ key: 'workspaces.content.styleExported' }); }, () => { notify.error({ key: 'workspaces.content.styleExportFailed' }); });
    });
  };
  const importStyles = () => { void menuHandler.open(<StyleImportForm workspaceId={activeWorkspace.id} onImported={refetch} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };
  //? The authoring dialog renders in the menu PORTAL → props-only; saveStyle is injected (lesson 0011).
  const openEditor = (initial?: StyleDraft) => {
    void menuHandler.open(<StyleEditorForm workspaceId={activeWorkspace.id} initial={initial} onSave={saveStyle} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
  };
  return (
    <SectionCard
      title={translate({ key: 'workspaces.content.stylesTitle' })}
      desc={translate({ key: 'workspaces.content.stylesDesc' })}
      right={(
        <div className={`flex items-center gap-2 shrink-0`}>
          <WsButton variant="secondary" icon="plus" onClick={() => { openEditor(); }}>{translate({ key: 'workspaces.content.styleNew' })}</WsButton>
          <PopMenu
            ariaLabel={translate({ key: 'workspaces.content.stylesMenu' })}
            items={[
              { label: translate({ key: 'workspaces.content.styleExport' }), icon: 'file-export', onClick: exportStyles },
              { label: translate({ key: 'workspaces.content.styleImport' }), icon: 'file-import', onClick: importStyles },
            ]}
          />
        </div>
      )}
    >
      {content.styles.length === 0
        ? (
          <EmptyState
            icon="wand-magic-sparkles"
            title={translate({ key: 'workspaces.content.stylesEmpty' })}
            sub={translate({ key: 'workspaces.content.stylesEmptyTeach' })}
            action={<WsButton icon="plus" className={`min-h-11`} onClick={() => { openEditor(); }}>{translate({ key: 'workspaces.content.styleNew' })}</WsButton>}
          />
        )
        : (
          <div className={`flex flex-col gap-1.5`}>
            {content.styles.map((s) => (
              <div key={`${s.feature}-${s.key}`} className={`flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2`}>
                {/* #155 — style preview thumbnail (M4 gallery). */}
                {s.previewAssetUrl && s.previewKind !== 'video' && <img src={mediaSrc(s.previewAssetUrl)} alt={s.label} className={`w-9 h-9 rounded-md object-cover border border-container1-border shrink-0`} />}
                <div className={`min-w-0 flex-1`}>
                  <div className={`text-sm font-medium text-title truncate`}>{s.label} <span className={`text-xs text-disabled`}>· {s.feature}</span></div>
                  <div className={`text-xs text-muted truncate`}>{s.systemPrompt}</div>
                </div>
                {s.builtin
                  ? <span className={`text-[10px] font-semibold text-muted rounded-md bg-container1 px-1.5 py-0.5 shrink-0`}>{translate({ key: 'workspaces.content.styleBuiltin' })}</span>
                  : (
                    <div className={`flex items-center gap-1 shrink-0`}>
                      {/* #157 — edit pre-fills the authoring dialog (upsert-by-key). */}
                      <button type="button" onClick={() => { openEditor(s); }} title={translate({ key: 'workspaces.content.styleEdit' })} className={`w-7 h-7 rounded-md text-muted hover:text-title hover:bg-container2 flex items-center justify-center cursor-pointer`}><Icon name="pen" /></button>
                      <button type="button" onClick={() => { deleteStyle(s.feature, s.key); }} title={translate({ key: 'workspaces.content.styleDelete' })} className={`w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer`}><Icon name="trash" /></button>
                    </div>
                  )}
              </div>
            ))}
          </div>
        )}
    </SectionCard>
  );
}

//? Inspiration/reference library — collect example ads/thumbnails/intros the content AI emulates. The
//? description is the grounding signal; the optional asset URL is the visual shown. Uses the generic
//? runContentOp (reference-add/reference-delete are content-* control-ops).
const REFERENCE_KINDS = ['ad', 'thumbnail', 'intro', 'hook', 'landing', 'other'];
function ReferenceLibraryBody() {
  const translate = useTranslator();
  const { content, runContentOp, activeWorkspace } = useWorkspaces();
  const kindItems: DropdownItem[] = REFERENCE_KINDS.map((k) => ({ id: k, value: k, item: translate({ key: `workspaces.content.refKind_${k}` }) }));
  const [kind, setKind] = useState('ad');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assetUrl, setAssetUrl] = useState('');
  const canSave = title.trim().length > 0 && description.trim().length > 0;
  const submit = () => {
    if (!canSave) return;
    runContentOp('reference-add', '', { kind, title: title.trim(), description: description.trim(), ...(assetUrl.trim() ? { assetUrl: assetUrl.trim() } : {}) });
    setTitle(''); setDescription(''); setAssetUrl('');
    notify.success({ key: 'workspaces.content.refAdded' });
  };
  const removeReference = (id: string): void => {
    void menuHandler.confirm({ title: translate({ key: 'workspaces.content.refDelete' }), content: translate({ key: 'workspaces.content.refDeleteConfirm' }) }).then((ok) => { if (ok) runContentOp('reference-delete', '', { referenceId: id }); });
  };
  return (
    <div>
      <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.content.refsDesc' })}</div>
      <div className={`flex flex-col gap-1.5 mb-4`}>
        {content.references.length === 0
          ? <div className={`text-sm text-disabled`}>{translate({ key: 'workspaces.content.refsEmpty' })}</div>
          : content.references.map((r) => (
            <div key={r.id} className={`flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2`}>
              {r.assetUrl ? <img src={mediaSrc(r.assetUrl)} alt="" className={`w-9 h-9 rounded-md object-cover shrink-0`} /> : <div className={`w-9 h-9 rounded-md bg-container1 flex items-center justify-center text-muted shrink-0`}><Icon name="image" /></div>}
              <div className={`min-w-0 flex-1`}>
                <div className={`text-sm font-medium text-title truncate`}>{r.title} <span className={`text-xs text-disabled`}>· {r.kind}</span></div>
                <div className={`text-xs text-muted truncate`}>{r.description}</div>
              </div>
              <button type="button" onClick={() => { removeReference(r.id); }} title={translate({ key: 'workspaces.content.refDelete' })} className={`w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer shrink-0`}><Icon name="trash" /></button>
            </div>
          ))}
      </div>
      <div className={`rounded-xl border border-dashed border-divider p-3 flex flex-col gap-2`}>
        <div className={`text-sm font-medium text-title`}>{translate({ key: 'workspaces.content.refNew' })}</div>
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2`}>
          <Dropdown size="md" width="full" value={kindItems.find((i) => i.id === kind)} items={kindItems} onChange={(it) => { setKind(String(it.id)); }} />
          <input value={title} onChange={(e) => { setTitle(e.target.value); }} placeholder={translate({ key: 'workspaces.content.refTitlePlaceholder' })} className={fieldCls} />
        </div>
        <textarea value={description} onChange={(e) => { setDescription(e.target.value); }} rows={2} placeholder={translate({ key: 'workspaces.content.refDescPlaceholder' })} className={`${fieldCls} resize-none`} />
        <div className={`flex flex-wrap items-center gap-2`}>
          <input value={assetUrl} onChange={(e) => { setAssetUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.refAssetPlaceholder' })} className={`min-w-0 flex-1 ${fieldCls}`} />
          {/* Real file upload → /media URL (or paste a URL above). */}
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*,video/*" labelKey="workspaces.content.refUpload" icon="up-right-from-square" onUploaded={(url) => { setAssetUrl(url); }} />
        </div>
        {assetUrl.trim() ? <img src={mediaSrc(assetUrl.trim())} alt="" className={`w-16 h-16 rounded-md object-cover border border-container2-border`} /> : null}
        <WsButton className={`self-start min-h-11`} disabled={!canSave} onClick={submit}>{translate({ key: 'workspaces.content.refSave' })}</WsButton>
      </div>
    </div>
  );
}

//? #84 — output-template manager (O5): reusable render specs (format + watermark position) a piece can
//? export with. The UI speaks the SERVER's real value sets — format is an ASPECT (16:9/9:16/1:1) and the
//? watermark position is ''|tl|tr|bl|br (a previous bug offered mp4/webm and silently coerced; keep it honest).
const OUTPUT_FORMATS = ['16:9', '9:16', '1:1'];
const WATERMARK_POSITIONS = ['', 'tl', 'tr', 'bl', 'br'];
const WM_LABEL_KEY: Record<string, string> = { '': 'wm_none', tl: 'wm_top_left', tr: 'wm_top_right', bl: 'wm_bottom_left', br: 'wm_bottom_right' };
function OutputTemplatesBody() {
  const translate = useTranslator();
  const { outputTemplates, saveOutputTemplate, deleteOutputTemplate } = useWorkspaces();
  const [name, setName] = useState('');
  const [format, setFormat] = useState(OUTPUT_FORMATS[0] ?? '16:9');
  const [watermark, setWatermark] = useState('');
  const formatItems: DropdownItem[] = OUTPUT_FORMATS.map((f) => ({ id: f, value: f, item: f }));
  const wmItems: DropdownItem[] = WATERMARK_POSITIONS.map((w) => ({ id: w, value: w, item: translate({ key: `workspaces.content.${WM_LABEL_KEY[w] ?? 'wm_none'}` }) }));
  const submit = () => {
    if (name.trim().length === 0) return;
    saveOutputTemplate({ name: name.trim(), format, watermarkPosition: watermark });
    setName('');
  };
  return (
    <div>
      <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.content.outputTemplatesDesc' })}</div>
      <div className={`flex flex-col gap-1.5 mb-4`}>
        {outputTemplates.length === 0
          ? <div className={`text-sm text-disabled`}>{translate({ key: 'workspaces.content.outputTemplatesEmpty' })}</div>
          : outputTemplates.map((t) => (
            <div key={t.id} className={`flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2`}>
              <div className={`min-w-0 flex-1`}>
                <div className={`text-sm font-medium text-title truncate`}>{t.name}</div>
                <div className={`text-xs text-muted truncate`}>{t.format}{t.watermarkPosition ? ` · ${translate({ key: `workspaces.content.${WM_LABEL_KEY[t.watermarkPosition] ?? 'wm_none'}` })}` : ''}</div>
              </div>
              <button type="button" onClick={() => { deleteOutputTemplate(t.id); }} title={translate({ key: 'workspaces.content.styleDelete' })} className={`w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer shrink-0`}><Icon name="trash" /></button>
            </div>
          ))}
      </div>
      <div className={`rounded-xl border border-dashed border-divider p-3 flex flex-col gap-2`}>
        <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.content.outputTemplateNamePlaceholder' })} className={fieldCls} />
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2`}>
          <Dropdown size="md" width="full" value={formatItems.find((i) => i.id === format)} items={formatItems} onChange={(it) => { setFormat(String(it.id)); }} />
          <Dropdown size="md" width="full" value={wmItems.find((i) => i.id === watermark)} items={wmItems} onChange={(it) => { setWatermark(String(it.id)); }} />
        </div>
        <WsButton className={`self-start min-h-11`} disabled={name.trim().length === 0} onClick={submit}>{translate({ key: 'workspaces.content.outputTemplateSave' })}</WsButton>
      </div>
    </div>
  );
}

export function BrandStylesTab() {
  const translate = useTranslator();
  const { content, outputTemplates } = useWorkspaces();
  return (
    <div className={`flex flex-col gap-4`}>
      <BrandContextCard />
      <StylesCard />
      <Disclosure summary={<span className={`flex items-center gap-2`}>{translate({ key: 'workspaces.content.refsTitle' })} <span className={`text-xs text-muted font-normal`}>{String(content.references.length)}</span></span>}>
        <ReferenceLibraryBody />
      </Disclosure>
      <Disclosure summary={<span className={`flex items-center gap-2`}>{translate({ key: 'workspaces.content.outputTemplatesTitle' })} <span className={`text-xs text-muted font-normal`}>{String(outputTemplates.length)}</span></span>}>
        <OutputTemplatesBody />
      </Disclosure>
    </div>
  );
}
