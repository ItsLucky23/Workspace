//? intent: content setup & settings — connect your AI media provider keys (encrypted) and set a media
//? €-budget cap + alert, with a guided first-run flow, so a non-technical user can safely turn on real
//? generation. Keys never leave the server; every save is a control-op (the Conductor writes, B-23).

import { useState } from 'react';

import { apiRequest, useTranslator, i18nNotify as notify } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { Toggle } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { backendUrl, oauthCallbackBase } from '../../../../config';

//? Prefix a backend-relative /media URL for the client origin (uploads land as /media/…); pass external URLs through.
const mediaSrc = (url: string): string => (url.startsWith('/media/') ? `${backendUrl}${url}` : url);

export const template = 'workspaces';

//? Publish platforms that have a real connect + upload flow (M5). Instagram/LinkedIn are future-ready.
//? A5 — health state → icon/colour (tokens only, Rule 14).
const HEALTH_ICON: Record<'ok' | 'warn' | 'down' | 'idle', string> = { ok: 'circle-check', warn: 'triangle-exclamation', down: 'circle-xmark', idle: 'circle-minus' };
const HEALTH_TEXT: Record<'ok' | 'warn' | 'down' | 'idle', string> = { ok: 'text-correct', warn: 'text-warning', down: 'text-wrong', idle: 'text-muted' };

const PUBLISH_PLATFORMS: { id: string; nameKey: string }[] = [
  { id: 'youtube', nameKey: 'workspaces.content.platformYoutube' },
  { id: 'tiktok', nameKey: 'workspaces.content.platformTiktok' },
];

//? Q5 — media providers (image/video/3d + voice/sfx + music) vs the AI TEXT provider (Gemini, used by the
//? script/analysis features). Split honestly so the user knows what each key drives — the Gemini key was
//? previously stored but consumed by nothing; it now feeds the text features (server/ai/providers/geminiApi).
const MEDIA_PROVIDERS: { id: string; nameKey: string; descKey: string }[] = [
  { id: 'fal', nameKey: 'workspaces.content.providerFal', descKey: 'workspaces.content.providerFalDesc' },
  { id: 'elevenlabs', nameKey: 'workspaces.content.providerEleven', descKey: 'workspaces.content.providerElevenDesc' },
  { id: 'suno', nameKey: 'workspaces.content.providerSuno', descKey: 'workspaces.content.providerSunoDesc' },
];
const AI_PROVIDERS: { id: string; nameKey: string; descKey: string }[] = [
  { id: 'gemini', nameKey: 'workspaces.content.providerGemini', descKey: 'workspaces.content.providerGeminiDesc' },
];

//? GAP_SCAN A7 — the platform APP credentials (the once-per-app YouTube/TikTok registration). Write-only:
//? the snapshot only says WHERE the credentials come from ('workspace' | 'env' | 'none'), never their value,
//? and the server stores them encrypted. Clearing both fields falls back to `.env`.
function PlatformCredentialsForm() {
  const translate = useTranslator();
  const { content, savePlatformCredentials } = useWorkspaces();
  const [platform, setPlatform] = useState('youtube');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saved, setSaved] = useState(false);
  const source = content.platformCredentials.find((c) => c.platform === platform)?.source ?? 'none';
  const platformItems: DropdownItem[] = PUBLISH_PLATFORMS.map((p) => ({ id: p.id, value: p.id, item: translate({ key: p.nameKey }) }));
  const inputCls = 'flex-1 min-w-40 rounded-lg border border-container2-border bg-container2 px-3 py-2 text-base md:text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring';
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="mb-3">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.appCredTitle' })}</div>
        <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.appCredDesc' })}</div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown size="md" value={platformItems.find((i) => i.id === platform)} items={platformItems} onChange={(it) => { setPlatform(String(it.id)); setSaved(false); }} />
          <span className={`text-xs ${source === 'none' ? 'text-muted' : 'text-correct'}`}>{translate({ key: `workspaces.content.appCredSource_${source}` })}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" autoComplete="off" value={clientId} onChange={(e) => { setClientId(e.target.value); setSaved(false); }} placeholder={translate({ key: 'workspaces.content.appCredId' })} className={inputCls} />
          <input type="password" autoComplete="new-password" value={clientSecret} onChange={(e) => { setClientSecret(e.target.value); setSaved(false); }} placeholder={translate({ key: 'workspaces.content.appCredSecret' })} className={inputCls} />
          <button
            type="button" disabled={clientId.trim().length === 0 || clientSecret.trim().length === 0}
            onClick={() => { savePlatformCredentials(platform, clientId.trim(), clientSecret.trim()); setClientId(''); setClientSecret(''); setSaved(true); }}
            className="min-h-11 rounded-lg bg-primary text-title-primary px-4 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >{translate({ key: 'workspaces.content.saveKey' })}</button>
        </div>
        {saved && <span className="text-xs text-correct flex items-center gap-1"><Icon name="circle-check" /> {translate({ key: 'workspaces.content.appCredSaved' })}</span>}
      </div>
    </section>
  );
}

function KeyRow({ name, desc, onSave }: { name: string; desc: string; onSave: (key: string) => void }) {
  const translate = useTranslator();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 py-3 border-b border-divider last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-title">{name}</span>
        <span className="text-xs text-muted">{desc}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          placeholder={translate({ key: 'workspaces.content.keyPlaceholder' })}
          className="flex-1 rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring"
        />
        <button
          type="button" disabled={value.trim().length === 0}
          onClick={() => { onSave(value.trim()); setValue(''); setSaved(true); }}
          className="rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >{translate({ key: 'workspaces.content.saveKey' })}</button>
      </div>
      {saved && <span className="text-xs text-correct flex items-center gap-1"><Icon name="circle-check" /> {translate({ key: `workspaces.content.savedFor` })} {name}</span>}
    </div>
  );
}

//? Q2 — the persistent brand/product context folded into EVERY creative generation, so the AI stays
//? on-brand without the user re-typing it. Saved via the content-edit-product control-op.
function ProductContextSection() {
  const translate = useTranslator();
  const { activeWorkspace, saveProductContext, saveBrandLogo } = useWorkspaces();
  const [value, setValue] = useState(activeWorkspace.productContext ?? '');
  const [saved, setSaved] = useState(false);
  //? Gap-fix — the brand logo the render WATERMARK overlays (the ffmpeg overlay existed but had no
  //? logo source). Uploaded to /media, persisted via content-edit-product.
  const [logoSet, setLogoSet] = useState(false);
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="mb-2">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.brandContextTitle' })}</div>
        <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.brandContextDesc' })}</div>
      </div>
      <textarea
        value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} rows={4}
        placeholder={translate({ key: 'workspaces.content.brandContextPlaceholder' })}
        className="w-full rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={() => { saveProductContext(value.trim()); setSaved(true); }} className="rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover cursor-pointer motion-safe:active:scale-[0.98]">{translate({ key: 'workspaces.content.brandContextSave' })}</button>
        {saved && <span className="text-xs text-correct flex items-center gap-1"><Icon name="circle-check" /> {translate({ key: 'workspaces.content.brandContextSaved' })}</span>}
      </div>
      <div className="mt-3 pt-3 border-t border-divider flex items-center justify-between gap-3">
        <span className="text-sm text-common" title={translate({ key: 'workspaces.content.brandLogoHint' })}>{translate({ key: 'workspaces.content.brandLogoLabel' })}</span>
        <div className="flex items-center gap-2">
          {logoSet && <span className="text-xs text-correct flex items-center gap-1"><Icon name="circle-check" /> {translate({ key: 'workspaces.content.brandLogoSet' })}</span>}
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.content.brandLogoUpload" icon="image" onUploaded={(url) => { saveBrandLogo(url); setLogoSet(true); }} />
        </div>
      </div>
    </section>
  );
}

//? Q3 — the style manager: list every style (global builtins are read-only, per-workspace ones edit/delete)
//? and author new named styles. A style is a reusable system-prompt per feature; the piece page picks one by
//? name instead of guessing a magic string. Saved via the save-style / delete-style control-ops.
const STYLE_FEATURES = ['script', 'image-gen', 'reference-image', 'video-gen', 'tts'];
//? #152 — paste a portable style-set JSON (from another workspace's Export) to import it (upsert-by-key).
function StyleImportForm({ workspaceId, onImported }: { workspaceId: string; onImported: () => void }) {
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
  const fieldCls = 'rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring';
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.styleImportTitle' })}</div>
      <textarea value={styles} onChange={(e) => { setStyles(e.target.value); }} rows={8} placeholder={translate({ key: 'workspaces.content.styleImportPlaceholder' })} className={`${fieldCls} font-mono resize-y`} />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => void menuHandler.close()} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-title cursor-pointer">{translate({ key: 'workspaces.shell.cancel' })}</button>
        <button type="button" disabled={busy || styles.trim().length === 0} onClick={submit} className="rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">{translate({ key: 'workspaces.content.styleImportAction' })}</button>
      </div>
    </div>
  );
}

//? #140 — the "connect an account" prompt: capture an optional short LABEL that becomes the account slug
//? (empty = the default single-account connection). Props-only (renders in the menu portal, above the
//? WorkspacesProvider) — it never calls useWorkspaces; the parent wires `onConnect` to the OAuth redirect.
function AccountConnectForm({ platformName, onConnect }: { platformName: string; onConnect: (label: string) => void }) {
  const translate = useTranslator();
  const [label, setLabel] = useState('');
  const fieldCls = 'rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring';
  const submit = () => { void menuHandler.close(); onConnect(label.trim()); };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.publishConnectAccountTitle', params: [{ key: 'platform', value: platformName }] })}</div>
      <div className="text-sm text-muted">{translate({ key: 'workspaces.content.publishConnectAccountDesc' })}</div>
      <input value={label} onChange={(e) => { setLabel(e.target.value); }} placeholder={translate({ key: 'workspaces.content.publishAccountLabelPlaceholder' })} className={fieldCls} />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => void menuHandler.close()} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-title cursor-pointer">{translate({ key: 'workspaces.shell.cancel' })}</button>
        <button type="button" onClick={submit} className="rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover cursor-pointer">{translate({ key: 'workspaces.content.publishConnect' })}</button>
      </div>
    </div>
  );
}

function StyleManagerSection() {
  const translate = useTranslator();
  const { content, saveStyle, deleteStyle, activeWorkspace, refetch } = useWorkspaces();
  const featureItems: DropdownItem[] = STYLE_FEATURES.map((f) => ({ id: f, value: f, item: f }));
  const [feature, setFeature] = useState<string>(STYLE_FEATURES[0] ?? 'image-gen');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<{ url: string; kind: string } | null>(null);   // #155
  const canSave = key.trim().length > 0 && prompt.trim().length > 0;
  const submit = () => {
    if (!canSave) return;
    saveStyle(feature, key.trim(), label.trim() || key.trim(), prompt.trim(), preview ? { previewAssetUrl: preview.url, previewKind: preview.kind } : undefined);
    setKey(''); setLabel(''); setPrompt(''); setPreview(null);
  };
  //? #157 — edit a non-builtin style: pre-fill the create form (upsert-by-key overwrites it on save).
  const editStyle = (s: { feature: string; key: string; label: string; systemPrompt: string; previewAssetUrl?: string | null; previewKind?: string | null }) => {
    setFeature(s.feature); setKey(s.key); setLabel(s.label); setPrompt(s.systemPrompt);
    setPreview(s.previewAssetUrl ? { url: s.previewAssetUrl, kind: s.previewKind ?? 'image' } : null);
  };
  //? #152 — portable style-set export (copy JSON) + import (paste JSON, upsert-by-key).
  const exportStyles = () => {
    void apiRequest({ name: 'workspaces/styleExport', version: 'v1', data: { workspaceId: activeWorkspace.id } }).then((r) => {
      if (r.status !== 'success' || r.result.styles.length === 0) { notify.error({ key: 'workspaces.content.styleExportEmpty' }); return; }
      void navigator.clipboard.writeText(r.result.styles).then(() => { notify.success({ key: 'workspaces.content.styleExported' }); }, () => { notify.error({ key: 'workspaces.content.styleExportFailed' }); });
    });
  };
  const importStyles = () => { void menuHandler.open(<StyleImportForm workspaceId={activeWorkspace.id} onImported={refetch} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.stylesTitle' })}</div>
          <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.stylesDesc' })}</div>
        </div>
        {/* #152 — export/import the portable style set. */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={exportStyles} title={translate({ key: 'workspaces.content.styleExport' })} className="w-8 h-8 rounded-md text-muted hover:text-title hover:bg-container2 flex items-center justify-center cursor-pointer"><Icon name="file-export" /></button>
          <button type="button" onClick={importStyles} title={translate({ key: 'workspaces.content.styleImport' })} className="w-8 h-8 rounded-md text-muted hover:text-title hover:bg-container2 flex items-center justify-center cursor-pointer"><Icon name="file-import" /></button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 mb-4">
        {content.styles.length === 0
          ? <div className="text-sm text-disabled">{translate({ key: 'workspaces.content.stylesEmpty' })}</div>
          : content.styles.map((s) => (
            <div key={`${s.feature}-${s.key}`} className="flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2">
              {/* #155 — style preview thumbnail (M4 gallery). */}
              {s.previewAssetUrl && s.previewKind !== 'video' && <img src={s.previewAssetUrl} alt={s.label} className="w-9 h-9 rounded-md object-cover border border-container1-border shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-title truncate">{s.label} <span className="text-xs text-disabled">· {s.feature}</span></div>
                <div className="text-xs text-muted truncate">{s.systemPrompt}</div>
              </div>
              {s.builtin
                ? <span className="text-[10px] font-semibold text-muted rounded-md bg-container1 px-1.5 py-0.5 shrink-0">{translate({ key: 'workspaces.content.styleBuiltin' })}</span>
                : (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* #157 — edit pre-fills the create form (upsert-by-key). */}
                    <button type="button" onClick={() => { editStyle(s); }} title={translate({ key: 'workspaces.content.styleEdit' })} className="w-7 h-7 rounded-md text-muted hover:text-title hover:bg-container2 flex items-center justify-center cursor-pointer"><Icon name="pen" /></button>
                    <button type="button" onClick={() => { deleteStyle(s.feature, s.key); }} title={translate({ key: 'workspaces.content.styleDelete' })} className="w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer"><Icon name="trash" /></button>
                  </div>
                )}
            </div>
          ))}
      </div>
      <div className="rounded-xl border border-dashed border-divider p-3 flex flex-col gap-2">
        <div className="text-sm font-medium text-title">{translate({ key: 'workspaces.content.styleNew' })}</div>
        <div className="grid grid-cols-2 gap-2">
          <Dropdown size="md" value={featureItems.find((i) => i.id === feature)} items={featureItems} onChange={(it) => { setFeature(String(it.id)); }} />
          <input value={key} onChange={(e) => { setKey(e.target.value); }} placeholder={translate({ key: 'workspaces.content.styleKeyPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
        </div>
        <input value={label} onChange={(e) => { setLabel(e.target.value); }} placeholder={translate({ key: 'workspaces.content.styleLabelPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
        <textarea value={prompt} onChange={(e) => { setPrompt(e.target.value); }} rows={2} placeholder={translate({ key: 'workspaces.content.stylePromptPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none" />
        {/* #155 — optional preview thumbnail: a sample of the look, shown in the style gallery. */}
        <div className="flex items-center gap-2">
          {preview && <img src={preview.url} alt="preview" className="w-10 h-10 rounded-md object-cover border border-container2-border" />}
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.content.stylePreviewUpload" icon="image" onUploaded={(url, kind) => { setPreview({ url, kind }); }} />
          {preview && <button type="button" onClick={() => { setPreview(null); }} className="text-xs text-muted hover:text-wrong cursor-pointer">{translate({ key: 'workspaces.content.stylePreviewRemove' })}</button>}
        </div>
        <button type="button" disabled={!canSave} onClick={submit} className="self-start rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer motion-safe:active:scale-[0.98]">{translate({ key: 'workspaces.content.styleSave' })}</button>
      </div>
    </section>
  );
}

//? P3 — advanced: override the fal MODEL per feature (e.g. a low-poly 3d model, a fast/cheap image model).
//? Free-text so any fal model id works; empty = the built-in default (shown as the placeholder).
const MODEL_FEATURES: { feature: string; def: string }[] = [
  { feature: 'image-gen', def: 'fal-ai/flux/dev' },
  { feature: 'reference-image', def: 'fal-ai/flux/dev/image-to-image' },
  { feature: 'video-gen', def: 'fal-ai/ltx-video' },
  { feature: 'model-3d', def: 'fal-ai/triposr' },
  { feature: 'avatar', def: 'fal-ai/ltx-video' },
];
function MediaModelRow({ feature, def, current, onSave }: { feature: string; def: string; current: string; onSave: (model: string) => void }) {
  const [value, setValue] = useState(current);
  return (
    <div className="flex items-center gap-2 py-2 border-b border-divider last:border-0">
      <span className="text-sm text-common w-40 shrink-0">{feature}</span>
      <input value={value} onChange={(e) => { setValue(e.target.value); }} onBlur={() => { if (value.trim() !== current) onSave(value.trim()); }} placeholder={def} className="flex-1 rounded-lg border border-container2-border bg-container2 px-3 py-1.5 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring font-mono" />
    </div>
  );
}
function MediaModelsSection() {
  const translate = useTranslator();
  const { content, saveMediaProvider } = useWorkspaces();
  const currentOf = (feature: string): string => content.mediaModels.find((m) => m.feature === feature)?.model ?? '';
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="mb-2">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.modelsTitle' })}</div>
        <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.modelsDesc' })}</div>
      </div>
      {MODEL_FEATURES.map((m) => (
        <MediaModelRow key={m.feature} feature={m.feature} def={m.def} current={currentOf(m.feature)} onSave={(model) => { saveMediaProvider({ feature: m.feature, model: model || 'default' }); }} />
      ))}
    </section>
  );
}

//? Inspiration/reference library — collect example ads/thumbnails/intros the content AI emulates. The
//? description is the grounding signal; the optional asset URL is the visual shown. Uses the generic
//? runContentOp (reference-add/reference-delete are content-* control-ops).
const REFERENCE_KINDS = ['ad', 'thumbnail', 'intro', 'hook', 'landing', 'other'];
function ReferenceLibrarySection() {
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
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="mb-3">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.refsTitle' })}</div>
        <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.refsDesc' })}</div>
      </div>
      <div className="flex flex-col gap-1.5 mb-4">
        {content.references.length === 0
          ? <div className="text-sm text-disabled">{translate({ key: 'workspaces.content.refsEmpty' })}</div>
          : content.references.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2">
              {r.assetUrl ? <img src={mediaSrc(r.assetUrl)} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" /> : <div className="w-9 h-9 rounded-md bg-container1 flex items-center justify-center text-muted shrink-0"><Icon name="image" /></div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-title truncate">{r.title} <span className="text-xs text-disabled">· {r.kind}</span></div>
                <div className="text-xs text-muted truncate">{r.description}</div>
              </div>
              <button type="button" onClick={() => { removeReference(r.id); }} title={translate({ key: 'workspaces.content.refDelete' })} className="w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer shrink-0"><Icon name="trash" /></button>
            </div>
          ))}
      </div>
      <div className="rounded-xl border border-dashed border-divider p-3 flex flex-col gap-2">
        <div className="text-sm font-medium text-title">{translate({ key: 'workspaces.content.refNew' })}</div>
        <div className="grid grid-cols-2 gap-2">
          <Dropdown size="md" value={kindItems.find((i) => i.id === kind)} items={kindItems} onChange={(it) => { setKind(String(it.id)); }} />
          <input value={title} onChange={(e) => { setTitle(e.target.value); }} placeholder={translate({ key: 'workspaces.content.refTitlePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
        </div>
        <textarea value={description} onChange={(e) => { setDescription(e.target.value); }} rows={2} placeholder={translate({ key: 'workspaces.content.refDescPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none" />
        <div className="flex items-center gap-2">
          <input value={assetUrl} onChange={(e) => { setAssetUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.refAssetPlaceholder' })} className="min-w-0 flex-1 rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
          {/* Real file upload → /media URL (or paste a URL above). */}
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*,video/*" labelKey="workspaces.content.refUpload" icon="up-right-from-square" onUploaded={(url) => { setAssetUrl(url); }} />
        </div>
        {assetUrl.trim() ? <img src={mediaSrc(assetUrl.trim())} alt="" className="w-16 h-16 rounded-md object-cover border border-container2-border" /> : null}
        <button type="button" disabled={!canSave} onClick={submit} className="self-start rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer motion-safe:active:scale-[0.98]">{translate({ key: 'workspaces.content.refSave' })}</button>
      </div>
    </section>
  );
}

//? Channel manager — a channel = a platform + brand identity a piece binds to (A2). Create/delete via the
//? generic runContentOp (channel-create/channel-delete are content-* control-ops).
//? Only YouTube + TikTok have publish builders (IG/LinkedIn record a 'platform.notBuilt' job), so they
//? are hidden from the channel platform picker until their builders land (#147 — consistent roadmap signal).
const CHANNEL_PLATFORMS = ['youtube', 'tiktok', 'none'];
function ChannelManagerSection() {
  const translate = useTranslator();
  const { content, runContentOp } = useWorkspaces();
  const platformItems: DropdownItem[] = CHANNEL_PLATFORMS.map((p) => ({ id: p, value: p, item: p }));
  //? #153 — the channel's default house style options (empty = no default).
  const styleItems: DropdownItem[] = [{ id: '', value: '', item: translate({ key: 'workspaces.content.channelNoStyle' }) }, ...content.styles.map((s) => ({ id: s.id, value: s.id, item: `${s.label} · ${s.feature}` }))];
  //? channel-edit (was UI-less): the create form doubles as an edit form. Editing loads the row into the fields
  //? and dispatches channel-edit (a patch) instead of channel-create.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('youtube');
  const [handle, setHandle] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [defaultStyleId, setDefaultStyleId] = useState('');   // #153 — the channel's house style
  //? AI-disclosure default: prefills the publish composer's synthetic-media checkbox; autopilot follows it.
  const [aiDisclosure, setAiDisclosure] = useState(false);
  //? Channel↔account-binding + autopilot (gap-fix): which connected account this channel posts with,
  //? and the per-channel autopilot consent (idea→render→publish without per-step approval).
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [autopilot, setAutopilot] = useState(false);
  const platformAccounts = content.publishTargets.find((t) => t.platform === platform)?.accounts ?? [];
  const accountItems: DropdownItem[] = [{ id: '', value: '', item: translate({ key: 'workspaces.content.channelDefaultAccount' }) }, ...platformAccounts.filter((a) => a.accountId !== null).map((a) => ({ id: a.accountId ?? '', value: a.accountId ?? '', item: a.accountId ?? '' }))];
  const canSave = name.trim().length > 0;
  const reset = () => { setEditingId(null); setName(''); setHandle(''); setBrandVoice(''); setPlatform('youtube'); setDefaultStyleId(''); setAiDisclosure(false); setDefaultAccountId(''); setAutopilot(false); };
  const startEdit = (c: { id: string; name: string; platform: string; handle?: string | null; brandVoice?: string | null; defaultStyleId?: string | null; aiDisclosureDefault?: boolean; defaultAccountId?: string | null; autopilot?: boolean }): void => {
    setEditingId(c.id); setName(c.name); setPlatform(c.platform); setHandle(c.handle ?? ''); setBrandVoice(c.brandVoice ?? ''); setDefaultStyleId(c.defaultStyleId ?? ''); setAiDisclosure(c.aiDisclosureDefault ?? false); setDefaultAccountId(c.defaultAccountId ?? ''); setAutopilot(c.autopilot ?? false);
  };
  //? Autopilot ON is a consent moment (it replaces every per-post approval) → an explicit confirm that
  //? also states the channel's current disclosure default.
  const toggleAutopilot = (next: boolean) => {
    if (!next) { setAutopilot(false); return; }
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.content.autopilotConfirmTitle' }),
      content: translate({ key: aiDisclosure ? 'workspaces.content.autopilotConfirmBody' : 'workspaces.content.autopilotConfirmBodyNoDisclosure' }),
    }).then((ok) => { if (ok) setAutopilot(true); });
  };
  const submit = () => {
    if (!canSave) return;
    if (editingId) runContentOp('channel-edit', '', { channelId: editingId, name: name.trim(), platform, handle: handle.trim(), brandVoice: brandVoice.trim(), defaultStyleId, aiDisclosureDefault: aiDisclosure, defaultAccountId, autopilot });
    else runContentOp('channel-create', '', { name: name.trim(), platform, ...(handle.trim() ? { handle: handle.trim() } : {}), ...(brandVoice.trim() ? { brandVoice: brandVoice.trim() } : {}), aiDisclosureDefault: aiDisclosure, ...(defaultAccountId ? { defaultAccountId } : {}), autopilot });
    reset();
  };
  const removeChannel = (id: string): void => {
    void menuHandler.confirm({ title: translate({ key: 'workspaces.content.channelDelete' }), content: translate({ key: 'workspaces.content.channelDeleteConfirm' }) }).then((ok) => { if (ok) { if (editingId === id) reset(); runContentOp('channel-delete', '', { channelId: id }); } });
  };
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="mb-3">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.channelsTitle' })}</div>
        <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.channelsDesc' })}</div>
      </div>
      <div className="flex flex-col gap-1.5 mb-4">
        {content.channels.length === 0
          ? <div className="text-sm text-disabled">{translate({ key: 'workspaces.content.channelsEmpty' })}</div>
          : content.channels.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-title truncate">{c.name} <span className="text-xs text-disabled">· {c.platform}{c.handle ? ` · ${c.handle}` : ''}</span>{c.autopilot && <span className="ml-1.5 rounded-full bg-warning/15 text-warning px-1.5 py-0.5 text-[10px] font-semibold uppercase">{translate({ key: 'workspaces.content.autopilotBadge' })}</span>}</div>
                {c.brandVoice ? <div className="text-xs text-muted truncate">{c.brandVoice}</div> : null}
              </div>
              <button type="button" onClick={() => { startEdit(c); }} title={translate({ key: 'workspaces.content.channelEdit' })} className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer shrink-0 ${editingId === c.id ? 'text-primary bg-primary/10' : 'text-muted hover:text-title hover:bg-container2-hover'}`}><Icon name="pen-nib" /></button>
              <button type="button" onClick={() => { removeChannel(c.id); }} title={translate({ key: 'workspaces.content.channelDelete' })} className="w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer shrink-0"><Icon name="trash" /></button>
            </div>
          ))}
      </div>
      <div className="rounded-xl border border-dashed border-divider p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-title">{translate({ key: editingId ? 'workspaces.content.channelEdit' : 'workspaces.content.channelNew' })}</div>
          {editingId && <button type="button" onClick={reset} className="text-xs text-muted hover:text-title cursor-pointer">{translate({ key: 'workspaces.shell.cancel' })}</button>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.content.channelNamePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
          <Dropdown size="md" value={platformItems.find((i) => i.id === platform)} items={platformItems} onChange={(it) => { setPlatform(String(it.id)); }} />
        </div>
        <input value={handle} onChange={(e) => { setHandle(e.target.value); }} placeholder={translate({ key: 'workspaces.content.channelHandlePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
        <input value={brandVoice} onChange={(e) => { setBrandVoice(e.target.value); }} placeholder={translate({ key: 'workspaces.content.channelVoicePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
        {/* #153 — the channel's house style (defaultStyleId), only meaningful when editing an existing channel. */}
        {editingId && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{translate({ key: 'workspaces.content.channelDefaultStyle' })}</span>
            <Dropdown size="md" value={styleItems.find((i) => i.id === defaultStyleId) ?? styleItems[0]} items={styleItems} onChange={(it) => { setDefaultStyleId(String(it.id)); }} />
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-common" title={translate({ key: 'workspaces.content.channelAiDisclosureHint' })}>{translate({ key: 'workspaces.content.channelAiDisclosure' })}</span>
          <Toggle on={aiDisclosure} onChange={setAiDisclosure} label={aiDisclosure ? translate({ key: 'workspaces.account.enabled' }) : translate({ key: 'workspaces.account.off' })} />
        </div>
        {accountItems.length > 1 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-common" title={translate({ key: 'workspaces.content.channelAccountHint' })}>{translate({ key: 'workspaces.content.channelAccount' })}</span>
            <Dropdown size="sm" value={accountItems.find((i) => i.id === defaultAccountId) ?? accountItems[0]} items={accountItems} onChange={(it) => { setDefaultAccountId(String(it.id)); }} />
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-common" title={translate({ key: 'workspaces.content.autopilotHint' })}>{translate({ key: 'workspaces.content.autopilotLabel' })}</span>
          <Toggle on={autopilot} onChange={toggleAutopilot} label={autopilot ? translate({ key: 'workspaces.account.enabled' }) : translate({ key: 'workspaces.account.off' })} />
        </div>
        <button type="button" disabled={!canSave} onClick={submit} className="self-start rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer motion-safe:active:scale-[0.98]">{translate({ key: 'workspaces.content.channelSave' })}</button>
      </div>
    </section>
  );
}

//? #84 — output-template manager (O5): reusable render specs (format + watermark position) a piece can
//? export with. Gap-fix: the UI previously offered CONTAINER values (mp4/webm/gif) and long position
//? names while the server validates format as an ASPECT (16:9/9:16/1:1) and positions as ''|br|bl|tr|tl
//? — every choice was silently coerced to 16:9/none. The UI now speaks the server's real value sets.
const OUTPUT_FORMATS = ['16:9', '9:16', '1:1'];
const WATERMARK_POSITIONS = ['', 'tl', 'tr', 'bl', 'br'];
const WM_LABEL_KEY: Record<string, string> = { '': 'wm_none', tl: 'wm_top_left', tr: 'wm_top_right', bl: 'wm_bottom_left', br: 'wm_bottom_right' };
function OutputTemplateSection() {
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
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="mb-3">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.outputTemplatesTitle' })}</div>
        <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.outputTemplatesDesc' })}</div>
      </div>
      <div className="flex flex-col gap-1.5 mb-4">
        {outputTemplates.length === 0
          ? <div className="text-sm text-disabled">{translate({ key: 'workspaces.content.outputTemplatesEmpty' })}</div>
          : outputTemplates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-title truncate">{t.name}</div>
                <div className="text-xs text-muted truncate">{t.format}{t.watermarkPosition ? ` · ${translate({ key: `workspaces.content.${WM_LABEL_KEY[t.watermarkPosition] ?? 'wm_none'}` })}` : ''}</div>
              </div>
              <button type="button" onClick={() => { deleteOutputTemplate(t.id); }} title={translate({ key: 'workspaces.content.styleDelete' })} className="w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer shrink-0"><Icon name="trash" /></button>
            </div>
          ))}
      </div>
      <div className="rounded-xl border border-dashed border-divider p-3 flex flex-col gap-2">
        <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.content.outputTemplateNamePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
        <div className="grid grid-cols-2 gap-2">
          <Dropdown size="md" value={formatItems.find((i) => i.id === format)} items={formatItems} onChange={(it) => { setFormat(String(it.id)); }} />
          <Dropdown size="md" value={wmItems.find((i) => i.id === watermark)} items={wmItems} onChange={(it) => { setWatermark(String(it.id)); }} />
        </div>
        <button type="button" disabled={name.trim().length === 0} onClick={submit} className="self-start rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">{translate({ key: 'workspaces.content.outputTemplateSave' })}</button>
      </div>
    </section>
  );
}

export default function ContentSettings() {
  const { content, activeWorkspace, editMediaBudget, saveMediaProvider, navigate, runContentOp, workspaces, copyWorkspaceAssets } = useWorkspaces();
  //? R2 — copy styles + brand from another workspace into this one (source picker + one-click).
  const [copySource, setCopySource] = useState('');
  //? A3/#146 — disconnect ONE connected account (confirm first — removing a credential). accountId null =
  //? the legacy default connection.
  const disconnectPlatform = (platform: string, accountId: string | null): void => {
    void menuHandler.confirm({ title: translate({ key: 'workspaces.content.publishDisconnect' }), content: translate({ key: 'workspaces.content.publishDisconnectConfirm' }) }).then((ok) => { if (ok) runContentOp('account-disconnect', '', { platform, ...(accountId ? { accountId } : {}) }); });
  };
  const translate = useTranslator();

  //? Start the OAuth connect: send the browser to the backend `start` route, which redirects to the
  //? platform's consent screen and (via the callback) stores the token, then returns here. #140 — an optional
  //? accountId opens a SEPARATE per-account connection (multi-account).
  const connectPlatform = (platform: string, accountId?: string) => {
    //? Use oauthCallbackBase (the BACKEND origin), not backendUrl (the Vite dev origin) — `/content/oauth/*`
    //? isn't in the dev proxy, and this is the host you register as the redirect URI with the provider.
    const base = `${oauthCallbackBase}/content/oauth/${platform}/start?ws=${encodeURIComponent(activeWorkspace.id)}`;
    globalThis.location.href = accountId && accountId.length > 0 ? `${base}&accountId=${encodeURIComponent(accountId)}` : base;
  };
  //? #140 — open the "connect another account" prompt (label → accountId slug); the form is injected props-only
  //? (it renders in the menu PORTAL, above WorkspacesProvider, so it must not call useWorkspaces — lesson 0011).
  const openConnectAccount = (platform: string, platformName: string) => {
    void menuHandler.open(<AccountConnectForm platformName={platformName} onConnect={(label) => { connectPlatform(platform, label); }} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
  };
  const budget = content.mediaBudget;
  const [enabled, setEnabled] = useState(budget.enabled);
  const [capEuros, setCapEuros] = useState((budget.capCents / 100).toString());
  const [alertPct, setAlertPct] = useState(budget.alertPct.toString());
  const [budgetSaved, setBudgetSaved] = useState(false);

  const saveBudget = () => {
    editMediaBudget({ enabled, capCents: Math.max(0, Math.round(Number(capEuros) * 100)) || 0, alertPct: Math.min(100, Math.max(0, Math.round(Number(alertPct)))) || 80 });
    setBudgetSaved(true);
  };

  //? Simplify: a content editor's day-to-day is brand/styles/channels/references (kept on first paint). The
  //? account-level knobs — raw model overrides, provider API keys, €-budget, publishing OAuth — are admin/owner
  //? concerns, so they're gated on role (fail-open: unresolved ≠ 'member') and collapsed behind one toggle.
  const showAdmin = activeWorkspace.role !== 'member';
  const [adminOpen, setAdminOpen] = useState(false);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
        <button type="button" onClick={() => { navigate('content'); }} title={translate({ key: 'workspaces.content.backToBoard' })} className="w-8 h-8 rounded-lg hover:bg-container2 text-muted hover:text-common flex items-center justify-center cursor-pointer">
          <Icon name="arrow-left" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-title">{translate({ key: 'workspaces.content.settingsTitle' })}</h1>
          <span className="text-sm text-muted">{translate({ key: 'workspaces.content.settingsSubtitle' })}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="flex flex-col gap-4 max-w-2xl">
          {/* First-run setup flow — the guided path + the guide link + a money warning. */}
          <section className="rounded-2xl border border-primary-border bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-lg bg-primary text-title-primary flex items-center justify-center shrink-0"><Icon name="wand-magic-sparkles" /></span>
              <div>
                <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.setupTitle' })}</div>
                <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.setupDesc' })}</div>
                <div className="mt-2 text-sm text-primary font-medium">{translate({ key: 'workspaces.content.setupGuideLink' })}</div>
                <div className="mt-2 flex items-start gap-2 text-xs text-muted">
                  <Icon name="triangle-exclamation" className="text-warning mt-0.5" /> {translate({ key: 'workspaces.content.costWarning' })}
                </div>
              </div>
            </div>
          </section>

          {/* Brand & product context — folded into every creative generation (Q2). */}
          <ProductContextSection />

          {/* Style manager — reusable named styles (Q3). */}
          <StyleManagerSection />

          {/* Channel manager — platforms + brand identity a piece binds to (A2). */}
          <ChannelManagerSection />

          {/* Inspiration/reference library — example ads/thumbnails/intros the AI emulates. */}
          <ReferenceLibrarySection />

          {/* #84 — output-template manager (reusable render specs). */}
          <OutputTemplateSection />

          {showAdmin && (
            <>
              <button type="button" onClick={() => { setAdminOpen((o) => !o); }} className="flex items-center justify-between gap-3 rounded-xl border border-container1-border bg-container1 px-4 py-3 text-sm font-medium text-title cursor-pointer">
                <span className="flex items-center gap-2"><Icon name="sliders" className="text-muted" /> {translate({ key: 'workspaces.content.advancedSection' })}</span>
                <Icon name="caret-down" className={`text-muted transition-transform motion-reduce:transition-none ${adminOpen ? 'rotate-180' : ''}`} />
              </button>
              {adminOpen && (
          <>{/* Media model overrides — advanced (P3). */}
          <MediaModelsSection />

          {/* Media provider API keys — stored ENCRYPTED, never shown back. */}
          <section className="rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-1">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.keysTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.keysDesc' })}</div>
            </div>
            {MEDIA_PROVIDERS.map((p) => (
              <KeyRow key={p.id} name={translate({ key: p.nameKey })} desc={translate({ key: p.descKey })} onSave={(key) => { saveMediaProvider({ providerId: p.id, apiKey: key }); }} />
            ))}
          </section>

          {/* AI text provider key (Gemini) — drives the script/analysis features (Q5). */}
          <section className="rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-1">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.aiKeysTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.aiKeysDesc' })}</div>
            </div>
            {AI_PROVIDERS.map((p) => (
              <KeyRow key={p.id} name={translate({ key: p.nameKey })} desc={translate({ key: p.descKey })} onSave={(key) => { saveMediaProvider({ providerId: p.id, apiKey: key }); }} />
            ))}
          </section>

          {/* Media €-budget — cap + alert so a runaway automation can't run up the bill. */}
          <section className="rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-3">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.budgetSectionTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.budgetSectionDesc' })}</div>
            </div>
            <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setBudgetSaved(false); }} className="accent-primary" />
              <span className="text-title">{translate({ key: 'workspaces.content.budgetEnabled' })}</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{translate({ key: 'workspaces.content.budgetCap' })}</span>
                <input type="number" min="0" step="1" value={capEuros} onChange={(e) => { setCapEuros(e.target.value); setBudgetSaved(false); }} disabled={!enabled} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title tabular-nums focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{translate({ key: 'workspaces.content.budgetAlert' })}</span>
                <input type="number" min="0" max="100" step="5" value={alertPct} onChange={(e) => { setAlertPct(e.target.value); setBudgetSaved(false); }} disabled={!enabled} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title tabular-nums focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50" />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button type="button" onClick={saveBudget} className="rounded-lg bg-primary text-title-primary px-4 py-2 text-sm font-medium hover:bg-primary-hover cursor-pointer">{translate({ key: 'workspaces.content.budgetSave' })}</button>
              {budgetSaved && <span className="text-xs text-correct flex items-center gap-1"><Icon name="circle-check" /> {translate({ key: 'workspaces.content.budgetSaved' })}</span>}
            </div>
          </section>

          <PlatformCredentialsForm />

          {/* GAP_SCAN A5 — per-channel publish health: one glance answers "is every channel still posting?".
              Derived from the publish-job history + the A4 connection markers; read-only. */}
          {content.channelHealth.length > 0 && (
            <section className="rounded-2xl border border-container1-border bg-container1 p-5">
              <div className="mb-3">
                <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.healthTitle' })}</div>
                <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.healthDesc' })}</div>
              </div>
              <div className="flex flex-col gap-2">
                {content.channelHealth.map((h) => (
                  <div key={h.channelId} className="rounded-xl border border-container2-border bg-container2 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name={HEALTH_ICON[h.state]} className={HEALTH_TEXT[h.state]} />
                      <span className="text-sm font-medium text-title truncate">{h.name}</span>
                      <span className="text-xs text-muted">{h.platform}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span>{translate({ key: `workspaces.content.health_${h.state}` })}</span>
                      <span className="tabular-nums">{translate({ key: 'workspaces.content.healthPosts' })}{': '}{String(h.posts)}</span>
                      {h.failures > 0 && <span className="tabular-nums text-wrong">{translate({ key: 'workspaces.content.healthFailures' })}{': '}{String(h.failures)}</span>}
                      <span>{h.lastSuccessAt === null ? translate({ key: 'workspaces.content.healthNever' }) : new Date(h.lastSuccessAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Publishing connections (FIX-C) — connect an account so a finished render can be posted (B-23 gated). */}
          <section className="rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-3">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.publishTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.publishDesc' })}</div>
            </div>
            <div className="flex flex-col gap-3">
              {PUBLISH_PLATFORMS.map((p) => {
                const target = content.publishTargets.find((t) => t.platform === p.id);
                const accounts = target?.accounts ?? [];
                const platformName = translate({ key: p.nameKey });
                return (
                  <div key={p.id} className="rounded-xl border border-container2-border bg-container2 px-3 py-2.5 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-title">{platformName}</span>
                      {/* #140 — connect the first / another account (opens a label prompt). */}
                      <button type="button" onClick={() => { openConnectAccount(p.id, platformName); }} className="rounded-lg border border-primary-border bg-primary/10 text-primary px-3 py-1.5 text-sm font-medium hover:bg-primary/20 cursor-pointer flex items-center gap-1.5">
                        <Icon name="link" /> {translate({ key: accounts.length > 0 ? 'workspaces.content.publishConnectAnother' : 'workspaces.content.publishConnect' })}
                      </button>
                    </div>
                    {/* #140/#146 — one row per connected account with its own disconnect. */}
                    {accounts.map((acc) => (
                      <div key={acc.accountId ?? '__default__'} className="flex items-center justify-between gap-3 pl-1">
                        {/* GAP_SCAN A4 — a dead token (refresh failed) shows a reconnect CTA instead of failing silently on the next post. */}
                        <span className={`text-xs font-medium flex items-center gap-1.5 ${acc.needsReconnect ? 'text-warning' : 'text-correct'}`}>
                          <Icon name={acc.needsReconnect ? 'triangle-exclamation' : 'circle-check'} /> {acc.accountId ?? translate({ key: 'workspaces.content.publishDefaultAccount' })}
                          {acc.needsReconnect && <span className="text-[10px] uppercase tracking-wide rounded-full bg-warning/15 px-1.5 py-0.5">{translate({ key: 'workspaces.content.publishNeedsReconnect' })}</span>}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {acc.needsReconnect && <button type="button" onClick={() => { openConnectAccount(p.id, platformName); }} className="text-xs text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.content.publishReconnect' })}</button>}
                          <button type="button" onClick={() => { disconnectPlatform(p.id, acc.accountId); }} className="text-xs text-muted hover:text-wrong cursor-pointer">{translate({ key: 'workspaces.content.publishDisconnect' })}</button>
                        </div>
                      </div>
                    ))}
                    {accounts.length === 0 && <span className="text-xs text-muted pl-1">{translate({ key: 'workspaces.content.publishNoAccounts' })}</span>}
                  </div>
                );
              })}
            </div>
          </section>

          {/* R2 — copy the user-authored styles + brand kit from another workspace into this one. */}
          <section className="rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-3">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.copyAssetsTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.copyAssetsDesc' })}</div>
            </div>
            {(() => {
              const others = workspaces.filter((w) => w.id !== activeWorkspace.id);
              if (others.length === 0) return <div className="text-sm text-disabled">{translate({ key: 'workspaces.content.copyAssetsNone' })}</div>;
              const items = others.map((w) => ({ id: w.id, value: w.id, item: w.name }));
              return (
                <div className="flex items-center gap-2">
                  <Dropdown size="md" value={items.find((i) => i.id === copySource)} items={items} onChange={(it) => { setCopySource(String(it.id)); }} />
                  <button type="button" disabled={!copySource} onClick={() => { copyWorkspaceAssets(copySource); setCopySource(''); }} className="shrink-0 rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">{translate({ key: 'workspaces.content.copyAssetsBtn' })}</button>
                </div>
              );
            })()}
          </section></>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
