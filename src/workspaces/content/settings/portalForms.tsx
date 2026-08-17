//? content/settings — forms opened via menuHandler.open(). They render in the menu PORTAL, ABOVE
//? WorkspacesProvider, so they are strictly props-only: NEVER call useWorkspaces here (lesson 0011).
//? The parent wires ids + save callbacks in.

import { useState } from 'react';

import { apiRequest, useTranslator, i18nNotify as notify } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { WsButton } from '../../_components/primitives';
import { fieldCls, mediaSrc, STYLE_FEATURES } from './shared';

//? #152 — paste a portable style-set JSON (from another workspace's Export) to import it (upsert-by-key).
export function StyleImportForm({ workspaceId, onImported }: { workspaceId: string; onImported: () => void }) {
  const translate = useTranslator();
  const [styles, setStyles] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (busy || styles.trim().length === 0) return;
    setBusy(true);
    void apiRequest({ name: 'workspaces/styleImport', version: 'v1', data: { workspaceId, styles: styles.trim() } }).then((r) => {
      setBusy(false);
      if (r.status === 'success') { notify.success({ key: 'workspaces.content.styleImported' }); void menuHandler.close(); onImported(); }
      else notify.error({ key: 'workspaces.content.styleImportFailed' });
    });
  };
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.content.styleImportTitle' })}</div>
      <textarea value={styles} onChange={(e) => { setStyles(e.target.value); }} rows={8} placeholder={translate({ key: 'workspaces.content.styleImportPlaceholder' })} className={`${fieldCls} font-mono resize-y`} />
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton className={`min-h-11`} disabled={busy || styles.trim().length === 0} onClick={submit}>{translate({ key: 'workspaces.content.styleImportAction' })}</WsButton>
      </div>
    </div>
  );
}

//? #140 — the "connect an account" prompt: capture an optional short LABEL that becomes the account slug
//? (empty = the default single-account connection). The parent wires `onConnect` to the OAuth redirect.
export function AccountConnectForm({ platformName, onConnect }: { platformName: string; onConnect: (label: string) => void }) {
  const translate = useTranslator();
  const [label, setLabel] = useState('');
  const submit = () => { void menuHandler.close(); onConnect(label.trim()); };
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.content.publishConnectAccountTitle', params: [{ key: 'platform', value: platformName }] })}</div>
      <div className={`text-sm text-muted`}>{translate({ key: 'workspaces.content.publishConnectAccountDesc' })}</div>
      <input value={label} onChange={(e) => { setLabel(e.target.value); }} placeholder={translate({ key: 'workspaces.content.publishAccountLabelPlaceholder' })} className={fieldCls} />
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton className={`min-h-11`} onClick={submit}>{translate({ key: 'workspaces.content.publishConnect' })}</WsButton>
      </div>
    </div>
  );
}

//? Q3 — the style-authoring dialog ('New style' opens it empty; edit pre-fills it). Save upserts BY KEY
//? via the injected onSave (the parent's saveStyle), so an edited key writes a new style — the exact
//? semantics the old inline form had (#157).
export interface StyleDraft { feature: string; key: string; label: string; systemPrompt: string; previewAssetUrl?: string | null; previewKind?: string | null }
export function StyleEditorForm({ workspaceId, initial, onSave }: {
  workspaceId: string;
  initial?: StyleDraft;
  onSave: (feature: string, key: string, label: string, systemPrompt: string, preview?: { previewAssetUrl: string; previewKind: string }) => void;
}) {
  const translate = useTranslator();
  const featureItems: DropdownItem[] = STYLE_FEATURES.map((f) => ({ id: f, value: f, item: f }));
  const [feature, setFeature] = useState<string>(initial?.feature ?? STYLE_FEATURES[0] ?? 'image-gen');
  const [key, setKey] = useState(initial?.key ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [prompt, setPrompt] = useState(initial?.systemPrompt ?? '');
  const [preview, setPreview] = useState<{ url: string; kind: string } | null>(initial?.previewAssetUrl ? { url: initial.previewAssetUrl, kind: initial.previewKind ?? 'image' } : null);
  const canSave = key.trim().length > 0 && prompt.trim().length > 0;
  const submit = () => {
    if (!canSave) return;
    onSave(feature, key.trim(), label.trim() || key.trim(), prompt.trim(), preview ? { previewAssetUrl: preview.url, previewKind: preview.kind } : undefined);
    void menuHandler.close();
  };
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: initial ? 'workspaces.content.styleEdit' : 'workspaces.content.styleNew' })}</div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2`}>
        <Dropdown size="md" width="full" value={featureItems.find((i) => i.id === feature)} items={featureItems} onChange={(it) => { setFeature(String(it.id)); }} />
        <input value={key} onChange={(e) => { setKey(e.target.value); }} placeholder={translate({ key: 'workspaces.content.styleKeyPlaceholder' })} className={fieldCls} />
      </div>
      <input value={label} onChange={(e) => { setLabel(e.target.value); }} placeholder={translate({ key: 'workspaces.content.styleLabelPlaceholder' })} className={fieldCls} />
      <textarea value={prompt} onChange={(e) => { setPrompt(e.target.value); }} rows={3} placeholder={translate({ key: 'workspaces.content.stylePromptPlaceholder' })} className={`${fieldCls} resize-none`} />
      {/* #155 — optional preview thumbnail: a sample of the look, shown in the style gallery. */}
      <div className={`flex flex-wrap items-center gap-2`}>
        {preview && <img src={mediaSrc(preview.url)} alt="" className={`w-10 h-10 rounded-md object-cover border border-container2-border`} />}
        <MediaUploadButton workspaceId={workspaceId} accept="image/*" labelKey="workspaces.content.stylePreviewUpload" icon="image" onUploaded={(url, kind) => { setPreview({ url, kind }); }} />
        {preview && <button type="button" onClick={() => { setPreview(null); }} className={`text-xs text-muted hover:text-wrong cursor-pointer`}>{translate({ key: 'workspaces.content.stylePreviewRemove' })}</button>}
      </div>
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton className={`min-h-11`} disabled={!canSave} onClick={submit}>{translate({ key: 'workspaces.content.styleSave' })}</WsButton>
      </div>
    </div>
  );
}
