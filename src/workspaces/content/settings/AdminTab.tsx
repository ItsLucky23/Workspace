//? content/settings — Tab 3 "Admin" (role-gated, fail-open): provider keys FIRST (the admin's main job),
//? the media €-budget second, then the rare knobs behind disclosures — per-feature model overrides (P3),
//? platform app credentials (A7) and copy-from-another-workspace (R2). Keys are write-only: stored
//? encrypted, never echoed back.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { Disclosure, SectionCard, Toggle, WsButton } from '../../_components/primitives';
import { FormSection, SavePill, SettingRow, useAutosave } from '../../_components/settings';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { fieldCls, PUBLISH_PLATFORMS } from './shared';

//? Q5 — media providers (image/video/3d + voice/sfx + music) only. The AI TEXT backend (Gemini, Claude,
//? …) is NOT a key row here: its single owner is Workspace → AI → Backends (AiConnection, ADR 0007).
//? A Gemini row used to live here too, writing `__provider_key_gemini` — a store the text dispatch never
//? read, so the key "saved" while generation kept failing (F-001/F-004).
const MEDIA_PROVIDERS: { id: string; nameKey: string; descKey: string }[] = [
  { id: 'fal', nameKey: 'workspaces.content.providerFal', descKey: 'workspaces.content.providerFalDesc' },
  { id: 'elevenlabs', nameKey: 'workspaces.content.providerEleven', descKey: 'workspaces.content.providerElevenDesc' },
  { id: 'suno', nameKey: 'workspaces.content.providerSuno', descKey: 'workspaces.content.providerSunoDesc' },
];

//? One write-only key row via the shared SettingRow grammar (was its own bespoke label/desc/input
//? stack — the audit found three different row shapes in this one tab, this is one of them). The
//? input clears after save and the row's SavePill confirms it, same as every other setting row.
function KeyRow({ name, desc, onSave }: { name: string; desc: string; onSave: (key: string) => void }) {
  const translate = useTranslator();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <SettingRow
      label={name}
      help={desc}
      status={saved ? 'saved' : 'idle'}
      stacked
      control={(
        <div className={`flex items-center gap-2`}>
          <input
            type="password" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }}
            placeholder={translate({ key: 'workspaces.content.keyPlaceholder' })}
            className={`flex-1 min-w-0 ${fieldCls}`}
          />
          <WsButton className={`min-h-11 shrink-0`} disabled={value.trim().length === 0} onClick={() => { onSave(value.trim()); setValue(''); setSaved(true); }}>{translate({ key: 'workspaces.content.saveKey' })}</WsButton>
        </div>
      )}
    />
  );
}

//? Provider keys — stored ENCRYPTED, never shown back. Media providers only; the text backend lives on
//? Workspace → AI → Backends (see the note on MEDIA_PROVIDERS). Saves via the dual-shape
//? saveMediaProvider ({providerId, apiKey} for keys; {feature, model} is the model-override shape below).
function KeysCard() {
  const translate = useTranslator();
  const { saveMediaProvider } = useWorkspaces();
  return (
    <FormSection title={translate({ key: 'workspaces.content.keysTitle' })} desc={translate({ key: 'workspaces.content.keysTeach' })}>
      {MEDIA_PROVIDERS.map((p) => (
        <KeyRow key={p.id} name={translate({ key: p.nameKey })} desc={translate({ key: p.descKey })} onSave={(key) => { saveMediaProvider({ providerId: p.id, apiKey: key }); }} />
      ))}
    </FormSection>
  );
}

//? Media €-budget — cap + alert so a runaway automation can't run up the bill. Cap/alert inputs are
//? disabled while the cap is off; € → cents rounding + the 0–100 alert clamp happen on save.
function BudgetCard() {
  const translate = useTranslator();
  const { content, editMediaBudget, navigate } = useWorkspaces();
  const budget = content.mediaBudget;
  const [enabled, setEnabled] = useState(budget.enabled);
  const [capEuros, setCapEuros] = useState((budget.capCents / 100).toString());
  const [alertPct, setAlertPct] = useState(budget.alertPct.toString());
  const budgetStatus = useAutosave([enabled, capEuros, alertPct], () => {
    const alert = Math.round(Number(alertPct));
    editMediaBudget({ enabled, capCents: Math.max(0, Math.round(Number(capEuros) * 100)) || 0, alertPct: Number.isFinite(alert) ? Math.min(100, Math.max(0, alert)) : 80 });
  });
  const numCls = `rounded-lg border border-container2-border bg-container2 px-3 py-2 text-base md:text-sm text-title tabular-nums focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50`;

  return (
    <SectionCard title={translate({ key: 'workspaces.content.budgetSectionTitle' })} desc={translate({ key: 'workspaces.content.budgetSectionDesc' })}>
      <label className={`flex items-center gap-2 text-sm mb-3 cursor-pointer`}>
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); }} className={`accent-primary`} />
        <span className={`text-title`}>{translate({ key: 'workspaces.content.budgetEnabled' })}</span>
      </label>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3`}>
        <label className={`flex flex-col gap-1 text-sm`}>
          <span className={`text-muted`}>{translate({ key: 'workspaces.content.budgetCap' })}</span>
          <input type="number" min="0" step="1" value={capEuros} onChange={(e) => { setCapEuros(e.target.value); }} disabled={!enabled} className={numCls} />
        </label>
        <label className={`flex flex-col gap-1 text-sm`}>
          <span className={`text-muted`}>{translate({ key: 'workspaces.content.budgetAlert' })}</span>
          <input type="number" min="0" max="100" step="5" value={alertPct} onChange={(e) => { setAlertPct(e.target.value); }} disabled={!enabled} className={numCls} />
        </label>
      </div>
      <div className={`mt-4 flex flex-wrap items-center gap-3`}>
        <SavePill status={budgetStatus} />
      </div>
      {/* Audit finding: this cap and the workspace-wide AI/token caps on Usage look like the same
          concept but are two separate budgets (media generation spend vs metered API spend) — say so
          instead of leaving the user to guess which one a given spend counts against. */}
      <div className={`mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted`}>
        <Icon name="circle-info" />
        <span>{translate({ key: 'workspaces.content.budgetScopeNote' })}</span>
        <button type="button" onClick={() => { navigate('usage'); }} className={`text-primary hover:underline cursor-pointer inline-flex items-center gap-1`}>
          {translate({ key: 'workspaces.content.budgetOtherCapsLink' })} <Icon name="arrow-right" />
        </button>
      </div>
    </SectionCard>
  );
}

//? P3 — advanced: override the generation MODEL per feature (fal image/video/3d + suno `music`, e.g. a
//? low-poly 3d model, a fast/cheap image model, or a different Suno version). Free-text so any model id works;
//? empty = the built-in default (shown as the placeholder). Saved on BLUR.
const MODEL_FEATURES: { feature: string; def: string }[] = [
  { feature: 'image-gen', def: 'fal-ai/flux/dev' },
  { feature: 'reference-image', def: 'fal-ai/flux/dev/image-to-image' },
  { feature: 'video-gen', def: 'fal-ai/ltx-video' },
  { feature: 'model-3d', def: 'fal-ai/triposr' },
  { feature: 'avatar', def: 'fal-ai/ltx-video' },
  { feature: 'music', def: 'V5' },
];
//? Same SettingRow grammar as KeyRow above — this used to be its own label-left/input-right shape,
//? the second of the tab's three row grammars. `-mx-4` on the parent list cancels the Disclosure
//? body's own px-4 so SettingRow's px-5 becomes the single source of horizontal inset.
function MediaModelRow({ feature, def, current, onSave }: { feature: string; def: string; current: string; onSave: (model: string) => void }) {
  const [value, setValue] = useState(current);
  return (
    <SettingRow
      label={feature}
      control={<input value={value} onChange={(e) => { setValue(e.target.value); }} onBlur={() => { if (value.trim() !== current) onSave(value.trim()); }} placeholder={def} className={`w-full rounded-lg border border-container2-border bg-container2 px-3 py-1.5 text-base md:text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring font-mono`} />}
    />
  );
}
function ModelOverridesBody() {
  const translate = useTranslator();
  const { content, saveMediaProvider } = useWorkspaces();
  const currentOf = (feature: string): string => content.mediaModels.find((m) => m.feature === feature)?.model ?? '';
  return (
    <div className={`-mx-4`}>
      <div className={`text-sm text-muted px-5 mb-1`}>{translate({ key: 'workspaces.content.modelsDesc' })}</div>
      <div className={`divide-y divide-divider`}>
        {MODEL_FEATURES.map((m) => (
          <MediaModelRow key={m.feature} feature={m.feature} def={m.def} current={currentOf(m.feature)} onSave={(model) => { saveMediaProvider({ feature: m.feature, model: model || 'default' }); }} />
        ))}
      </div>
    </div>
  );
}

//? Workspace-wide media generation defaults — each overrides its host-env fallback (WS_MEDIA_CHEAP /
//? WS_SCENE_CONTINUITY / ELEVENLABS_VOICE_ID). The toggles save immediately (source of truth = the snapshot,
//? refetched after the write); the default voice id saves on BLUR like the model overrides. Third of the
//? tab's three row grammars, now unified on SettingRow too — was a bare checkbox+label with the help text
//? indented below it.
function GenerationDefaultsCard() {
  const translate = useTranslator();
  const { content, saveMediaProvider, activeWorkspace } = useWorkspaces();
  const prefs = content.mediaPrefs;
  const [voiceId, setVoiceId] = useState(prefs.voiceId);
  const voiceStatus = useAutosave([voiceId], () => { if (voiceId.trim() !== prefs.voiceId) saveMediaProvider({ voiceId: voiceId.trim() }); }, { resetKey: activeWorkspace.id });
  const onOffLabel = (on: boolean) => translate({ key: on ? 'workspaces.account.enabled' : 'workspaces.account.off' });
  return (
    <FormSection title={translate({ key: 'workspaces.content.genDefaultsTitle' })} desc={translate({ key: 'workspaces.content.genDefaultsDesc' })}>
      <SettingRow
        label={translate({ key: 'workspaces.content.cheapLabel' })}
        help={translate({ key: 'workspaces.content.cheapDesc' })}
        control={<Toggle on={prefs.cheap} onChange={(next) => { saveMediaProvider({ cheap: next }); }} label={onOffLabel(prefs.cheap)} />}
      />
      <SettingRow
        label={translate({ key: 'workspaces.content.sceneContinuityLabel' })}
        help={translate({ key: 'workspaces.content.sceneContinuityDesc' })}
        control={<Toggle on={prefs.sceneContinuity} onChange={(next) => { saveMediaProvider({ sceneContinuity: next }); }} label={onOffLabel(prefs.sceneContinuity)} />}
      />
      <SettingRow
        label={translate({ key: 'workspaces.content.voiceIdLabel' })}
        help={translate({ key: 'workspaces.content.voiceIdDesc' })}
        stacked
        control={<div className={`flex items-center gap-2`}><input value={voiceId} onChange={(e) => { setVoiceId(e.target.value); }} placeholder={translate({ key: 'workspaces.content.voiceIdPlaceholder' })} className={`w-full ${fieldCls}`} /><SavePill status={voiceStatus} /></div>}
      />
    </FormSection>
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
        <Dropdown size="md" width="full" value={platformItems.find((i) => i.id === platform)} items={platformItems} onChange={(it) => { setPlatform(String(it.id)); setSaved(false); }} />
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
      <GenerationDefaultsCard />
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
