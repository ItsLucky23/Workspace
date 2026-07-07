//? intent: content setup & settings — connect your AI media provider keys (encrypted) and set a media
//? €-budget cap + alert, with a guided first-run flow, so a non-technical user can safely turn on real
//? generation. Keys never leave the server; every save is a control-op (the Conductor writes, B-23).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { backendUrl } from '../../../../config';

export const template = 'workspaces';

//? Publish platforms that have a real connect + upload flow (M5). Instagram/LinkedIn are future-ready.
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
  const { activeWorkspace, saveProductContext } = useWorkspaces();
  const [value, setValue] = useState(activeWorkspace.productContext ?? '');
  const [saved, setSaved] = useState(false);
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
    </section>
  );
}

//? Q3 — the style manager: list every style (global builtins are read-only, per-workspace ones edit/delete)
//? and author new named styles. A style is a reusable system-prompt per feature; the piece page picks one by
//? name instead of guessing a magic string. Saved via the save-style / delete-style control-ops.
const STYLE_FEATURES = ['script', 'image-gen', 'reference-image', 'video-gen', 'tts'];
function StyleManagerSection() {
  const translate = useTranslator();
  const { content, saveStyle, deleteStyle } = useWorkspaces();
  const featureItems: DropdownItem[] = STYLE_FEATURES.map((f) => ({ id: f, value: f, item: f }));
  const [feature, setFeature] = useState<string>(STYLE_FEATURES[0] ?? 'image-gen');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [prompt, setPrompt] = useState('');
  const canSave = key.trim().length > 0 && prompt.trim().length > 0;
  const submit = () => {
    if (!canSave) return;
    saveStyle(feature, key.trim(), label.trim() || key.trim(), prompt.trim());
    setKey(''); setLabel(''); setPrompt('');
  };
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="mb-3">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.stylesTitle' })}</div>
        <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.stylesDesc' })}</div>
      </div>
      <div className="flex flex-col gap-1.5 mb-4">
        {content.styles.length === 0
          ? <div className="text-sm text-disabled">{translate({ key: 'workspaces.content.stylesEmpty' })}</div>
          : content.styles.map((s) => (
            <div key={`${s.feature}-${s.key}`} className="flex items-center gap-2 rounded-lg border border-container2-border bg-container2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-title truncate">{s.label} <span className="text-xs text-disabled">· {s.feature}</span></div>
                <div className="text-xs text-muted truncate">{s.systemPrompt}</div>
              </div>
              {s.builtin
                ? <span className="text-[10px] font-semibold text-muted rounded-md bg-container1 px-1.5 py-0.5 shrink-0">{translate({ key: 'workspaces.content.styleBuiltin' })}</span>
                : <button type="button" onClick={() => { deleteStyle(s.feature, s.key); }} title={translate({ key: 'workspaces.content.styleDelete' })} className="w-7 h-7 rounded-md text-muted hover:text-wrong hover:bg-wrong/10 flex items-center justify-center cursor-pointer shrink-0"><Icon name="trash" /></button>}
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

export default function ContentSettings() {
  const { content, activeWorkspace, editMediaBudget, saveMediaProvider, navigate } = useWorkspaces();
  const translate = useTranslator();

  //? Start the OAuth connect: send the browser to the backend `start` route, which redirects to the
  //? platform's consent screen and (via the callback) stores the token, then returns here.
  const connectPlatform = (platform: string) => {
    globalThis.location.href = `${backendUrl}/content/oauth/${platform}/start?ws=${encodeURIComponent(activeWorkspace.id)}`;
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

          {/* Media model overrides — advanced (P3). */}
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

          {/* Publishing connections (FIX-C) — connect an account so a finished render can be posted (B-23 gated). */}
          <section className="rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-3">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.publishTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.publishDesc' })}</div>
            </div>
            <div className="flex flex-col gap-2">
              {PUBLISH_PLATFORMS.map((p) => {
                const connected = content.publishTargets.find((t) => t.platform === p.id)?.connected ?? false;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-container2-border bg-container2 px-3 py-2.5">
                    <span className="text-sm font-medium text-title">{translate({ key: p.nameKey })}</span>
                    {connected ? (
                      <span className="text-xs font-medium text-correct flex items-center gap-1.5"><Icon name="circle-check" /> {translate({ key: 'workspaces.content.publishConnected' })}</span>
                    ) : (
                      <button type="button" onClick={() => { connectPlatform(p.id); }} className="rounded-lg border border-primary-border bg-primary/10 text-primary px-3 py-1.5 text-sm font-medium hover:bg-primary/20 cursor-pointer flex items-center gap-1.5">
                        <Icon name="link" /> {translate({ key: 'workspaces.content.publishConnect' })}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
