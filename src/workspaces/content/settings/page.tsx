//? intent: content setup & settings — connect your AI media provider keys (encrypted) and set a media
//? €-budget cap + alert, with a guided first-run flow, so a non-technical user can safely turn on real
//? generation. Keys never leave the server; every save is a control-op (the Conductor writes, B-23).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { backendUrl } from '../../../../config';

export const template = 'workspaces';

//? Publish platforms that have a real connect + upload flow (M5). Instagram/LinkedIn are future-ready.
const PUBLISH_PLATFORMS: { id: string; nameKey: string }[] = [
  { id: 'youtube', nameKey: 'workspaces.content.platformYoutube' },
  { id: 'tiktok', nameKey: 'workspaces.content.platformTiktok' },
];

const PROVIDERS: { id: string; nameKey: string; descKey: string }[] = [
  { id: 'fal', nameKey: 'workspaces.content.providerFal', descKey: 'workspaces.content.providerFalDesc' },
  { id: 'elevenlabs', nameKey: 'workspaces.content.providerEleven', descKey: 'workspaces.content.providerElevenDesc' },
  { id: 'suno', nameKey: 'workspaces.content.providerSuno', descKey: 'workspaces.content.providerSunoDesc' },
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

          {/* Provider API keys — stored ENCRYPTED, never shown back. */}
          <section className="rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-1">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.keysTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.keysDesc' })}</div>
            </div>
            {PROVIDERS.map((p) => (
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
