//? content/settings — Tab 3 "Admin" (role-gated, fail-open): provider keys FIRST (the admin's main job),
//? the media €-budget second, then the rare knobs behind disclosures — per-feature model overrides (P3),
//? platform app credentials (A7) and copy-from-another-workspace (R2). Keys are write-only: stored
//? encrypted, never echoed back.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import { Disclosure, SectionCard, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { SavedNote } from './SavedNote';
import { fieldCls, PUBLISH_PLATFORMS } from './shared';

//? Q5 — media providers (image/video/3d + voice/sfx + music) vs the AI TEXT provider (Gemini, used by the
//? script/analysis features). Split honestly so the user knows what each key drives.
const MEDIA_PROVIDERS: { id: string; nameKey: string; descKey: string }[] = [
  { id: 'fal', nameKey: 'workspaces.content.providerFal', descKey: 'workspaces.content.providerFalDesc' },
  { id: 'elevenlabs', nameKey: 'workspaces.content.providerEleven', descKey: 'workspaces.content.providerElevenDesc' },
  { id: 'suno', nameKey: 'workspaces.content.providerSuno', descKey: 'workspaces.content.providerSunoDesc' },
];
const AI_PROVIDERS: { id: string; nameKey: string; descKey: string }[] = [
  { id: 'gemini', nameKey: 'workspaces.content.providerGemini', descKey: 'workspaces.content.providerGeminiDesc' },
];

//? One write-only key row: the input clears after save and a transient "saved" note confirms it.
function KeyRow({ name, desc, onSave }: { name: string; desc: string; onSave: (key: string) => void }) {
  const translate = useTranslator();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <div className={`flex flex-col gap-1.5 py-3 border-b border-divider last:border-0`}>
      <div className={`flex items-baseline justify-between gap-2`}>
        <span className={`text-sm font-medium text-title`}>{name}</span>
        <span className={`text-xs text-muted`}>{desc}</span>
      </div>
      <div className={`flex items-center gap-2`}>
        <input
          type="password" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          placeholder={translate({ key: 'workspaces.content.keyPlaceholder' })}
          className={`flex-1 min-w-0 ${fieldCls}`}
        />
        <WsButton className={`min-h-11 shrink-0`} disabled={value.trim().length === 0} onClick={() => { onSave(value.trim()); setValue(''); setSaved(true); }}>{translate({ key: 'workspaces.content.saveKey' })}</WsButton>
      </div>
      {saved && <SavedNote text={`${translate({ key: 'workspaces.content.savedFor' })} ${name}`} />}
    </div>
  );
}

//? Provider keys — stored ENCRYPTED, never shown back. Media providers first, then the AI text provider
//? (Gemini — drives the script/analysis features, Q5). Both save via the dual-shape saveMediaProvider
//? ({providerId, apiKey} for keys; {feature, model} is the model-override shape below).
function KeysCard() {
  const translate = useTranslator();
  const { saveMediaProvider } = useWorkspaces();
  return (
    <SectionCard title={translate({ key: 'workspaces.content.keysTitle' })} desc={translate({ key: 'workspaces.content.keysTeach' })}>
      {MEDIA_PROVIDERS.map((p) => (
        <KeyRow key={p.id} name={translate({ key: p.nameKey })} desc={translate({ key: p.descKey })} onSave={(key) => { saveMediaProvider({ providerId: p.id, apiKey: key }); }} />
      ))}
      <div className={`mt-4`}>
        <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.content.aiKeysTitle' })}</div>
        <div className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.content.aiKeysDesc' })}</div>
      </div>
      {AI_PROVIDERS.map((p) => (
        <KeyRow key={p.id} name={translate({ key: p.nameKey })} desc={translate({ key: p.descKey })} onSave={(key) => { saveMediaProvider({ providerId: p.id, apiKey: key }); }} />
      ))}
    </SectionCard>
  );
}

//? Media €-budget — cap + alert so a runaway automation can't run up the bill. Cap/alert inputs are
//? disabled while the cap is off; € → cents rounding + the 0–100 alert clamp happen on save.
function BudgetCard() {
  const translate = useTranslator();
  const { content, editMediaBudget } = useWorkspaces();
  const budget = content.mediaBudget;
  const [enabled, setEnabled] = useState(budget.enabled);
  const [capEuros, setCapEuros] = useState((budget.capCents / 100).toString());
  const [alertPct, setAlertPct] = useState(budget.alertPct.toString());
  const [saved, setSaved] = useState(false);
  const numCls = `rounded-lg border border-container2-border bg-container2 px-3 py-2 text-base md:text-sm text-title tabular-nums focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50`;
  const save = () => {
    editMediaBudget({ enabled, capCents: Math.max(0, Math.round(Number(capEuros) * 100)) || 0, alertPct: Math.min(100, Math.max(0, Math.round(Number(alertPct)))) || 80 });
    setSaved(true);
  };
  return (
    <SectionCard title={translate({ key: 'workspaces.content.budgetSectionTitle' })} desc={translate({ key: 'workspaces.content.budgetSectionDesc' })}>
      <label className={`flex items-center gap-2 text-sm mb-3 cursor-pointer`}>
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} className={`accent-primary`} />
        <span className={`text-title`}>{translate({ key: 'workspaces.content.budgetEnabled' })}</span>
      </label>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3`}>
        <label className={`flex flex-col gap-1 text-sm`}>
          <span className={`text-muted`}>{translate({ key: 'workspaces.content.budgetCap' })}</span>
          <input type="number" min="0" step="1" value={capEuros} onChange={(e) => { setCapEuros(e.target.value); setSaved(false); }} disabled={!enabled} className={numCls} />
        </label>
        <label className={`flex flex-col gap-1 text-sm`}>
          <span className={`text-muted`}>{translate({ key: 'workspaces.content.budgetAlert' })}</span>
          <input type="number" min="0" max="100" step="5" value={alertPct} onChange={(e) => { setAlertPct(e.target.value); setSaved(false); }} disabled={!enabled} className={numCls} />
        </label>
      </div>
      <div className={`mt-4 flex flex-wrap items-center gap-3`}>
        <WsButton className={`min-h-11`} onClick={save}>{translate({ key: 'workspaces.content.budgetSave' })}</WsButton>
        {saved && <SavedNote text={translate({ key: 'workspaces.content.budgetSaved' })} />}
      </div>
    </SectionCard>
  );
}

//? P3 — advanced: override the fal MODEL per feature (e.g. a low-poly 3d model, a fast/cheap image model).
//? Free-text so any fal model id works; empty = the built-in default (shown as the placeholder). Saved on BLUR.
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
    <div className={`flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 py-2 border-b border-divider last:border-0`}>
      <span className={`text-sm text-common sm:w-40 shrink-0`}>{feature}</span>
      <input value={value} onChange={(e) => { setValue(e.target.value); }} onBlur={() => { if (value.trim() !== current) onSave(value.trim()); }} placeholder={def} className={`w-full sm:flex-1 min-w-0 rounded-lg border border-container2-border bg-container2 px-3 py-1.5 text-base md:text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring font-mono`} />
    </div>
  );
}
function ModelOverridesBody() {
  const translate = useTranslator();
  const { content, saveMediaProvider } = useWorkspaces();
  const currentOf = (feature: string): string => content.mediaModels.find((m) => m.feature === feature)?.model ?? '';
  return (
    <div>
      <div className={`text-sm text-muted mb-2`}>{translate({ key: 'workspaces.content.modelsDesc' })}</div>
      {MODEL_FEATURES.map((m) => (
        <MediaModelRow key={m.feature} feature={m.feature} def={m.def} current={currentOf(m.feature)} onSave={(model) => { saveMediaProvider({ feature: m.feature, model: model || 'default' }); }} />
      ))}
    </div>
  );
}

//? GAP_SCAN A7 — the platform APP credentials (the once-per-app YouTube/TikTok registration). Write-only:
//? the snapshot only says WHERE the credentials come from ('workspace' | 'env' | 'none'), never their value,
//? and the server stores them encrypted. Clearing both fields falls back to `.env`.
function PlatformCredentialsBody() {
  const translate = useTranslator();
  const { content, savePlatformCredentials } = useWorkspaces();
  const [platform, setPlatform] = useState('youtube');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saved, setSaved] = useState(false);
  const source = content.platformCredentials.find((c) => c.platform === platform)?.source ?? 'none';
  const platformItems: DropdownItem[] = PUBLISH_PLATFORMS.map((p) => ({ id: p.id, value: p.id, item: translate({ key: p.nameKey }) }));
  return (
    <div className={`flex flex-col gap-2`}>
      <div className={`text-sm text-muted`}>{translate({ key: 'workspaces.content.appCredDesc' })}</div>
      <div className={`flex flex-wrap items-center gap-2`}>
        <Dropdown size="md" value={platformItems.find((i) => i.id === platform)} items={platformItems} onChange={(it) => { setPlatform(String(it.id)); setSaved(false); }} />
        <span className={`text-xs ${source === 'none' ? 'text-muted' : 'text-correct'}`}>{translate({ key: `workspaces.content.appCredSource_${source}` })}</span>
      </div>
      <div className={`flex flex-wrap items-center gap-2`}>
        <input type="text" autoComplete="off" value={clientId} onChange={(e) => { setClientId(e.target.value); setSaved(false); }} placeholder={translate({ key: 'workspaces.content.appCredId' })} className={`flex-1 min-w-40 ${fieldCls}`} />
        <input type="password" autoComplete="new-password" value={clientSecret} onChange={(e) => { setClientSecret(e.target.value); setSaved(false); }} placeholder={translate({ key: 'workspaces.content.appCredSecret' })} className={`flex-1 min-w-40 ${fieldCls}`} />
        <WsButton
          className={`min-h-11`} disabled={clientId.trim().length === 0 || clientSecret.trim().length === 0}
          onClick={() => { savePlatformCredentials(platform, clientId.trim(), clientSecret.trim()); setClientId(''); setClientSecret(''); setSaved(true); }}
        >{translate({ key: 'workspaces.content.saveKey' })}</WsButton>
      </div>
      {saved && <SavedNote text={translate({ key: 'workspaces.content.appCredSaved' })} />}
    </div>
  );
}

//? R2 — copy the user-authored styles + brand kit from another workspace into this one (rare, one-time).
function CopyAssetsBody() {
  const translate = useTranslator();
  const { workspaces, activeWorkspace, copyWorkspaceAssets } = useWorkspaces();
  const [copySource, setCopySource] = useState('');
  const others = workspaces.filter((w) => w.id !== activeWorkspace.id);
  if (others.length === 0) return <div className={`text-sm text-disabled`}>{translate({ key: 'workspaces.content.copyAssetsNone' })}</div>;
  const items: DropdownItem[] = others.map((w) => ({ id: w.id, value: w.id, item: w.name }));
  return (
    <div>
      <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.content.copyAssetsDesc' })}</div>
      <div className={`flex flex-wrap items-center gap-2`}>
        <Dropdown size="md" value={items.find((i) => i.id === copySource)} items={items} onChange={(it) => { setCopySource(String(it.id)); }} />
        <WsButton className={`min-h-11 shrink-0`} disabled={!copySource} onClick={() => { copyWorkspaceAssets(copySource); setCopySource(''); }}>{translate({ key: 'workspaces.content.copyAssetsBtn' })}</WsButton>
      </div>
    </div>
  );
}

export function AdminTab() {
  const translate = useTranslator();
  return (
    <div className={`flex flex-col gap-4`}>
      <KeysCard />
      <BudgetCard />
      <Disclosure summary={translate({ key: 'workspaces.content.modelsTitle' })}>
        <ModelOverridesBody />
      </Disclosure>
      <Disclosure summary={translate({ key: 'workspaces.content.appCredTitle' })}>
        <PlatformCredentialsBody />
      </Disclosure>
      <Disclosure summary={translate({ key: 'workspaces.content.copyAssetsTitle' })}>
        <CopyAssetsBody />
      </Disclosure>
    </div>
  );
}
