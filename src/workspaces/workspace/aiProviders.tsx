//? The general AI setup, on the page it belongs to (ADR 0007).
//?
//? What this replaces: a status dot per backend, three free-text Gemini fields, and — for the one thing
//? you actually have to do, entering a key — a redirect to the CONTENT settings page, next to
//? ElevenLabs and Suno. Two problems with that. Media providers belong with media; the text backend
//? runs the whole product (pipeline agents, the assistant, docs, reviews) and configuring it is not a
//? content task. And a model name you type from memory is a field that is wrong more often than right.
//?
//? Every row here is rendered from the server's provider catalog, so adding a backend is a server-only
//? change: an entry in `server/ai/providers/catalog.ts` plus an implementation. Nothing to add here.
//?
//? The key is WRITE-ONLY. A stored key shows as "set" and the input stays empty; typing nothing sends
//? no `apiKey` at all, so saving a model can never wipe a credential.
//? @adr 0007

/* eslint-disable react-refresh/only-export-components -- the row and its small helpers are one feature; a separate file for a two-line predicate only satisfies a dev-only fast-refresh rule. Not a route component. */
import { useEffect, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../_components/Icon';
import { FormSection, SettingRow } from '../_components/settings';
import { WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { AiProviderConfig } from '../_data/types';

const inputCls = 'h-9 w-full px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

//? The escape hatch on every model dropdown: the catalog is a starting point, not a whitelist, and a
//? model released after it was written must not make the backend unusable.
const CUSTOM = '__custom__';

export function AiProvidersSection({ health }: { health: { id: string; label: string; available: boolean }[] | null }) {
  const translate = useTranslator();
  const { aiProviderConfigs } = useWorkspaces();

  return (
    <FormSection
      title={translate({ key: 'workspaces.aiProviders.title' })}
      desc={translate({ key: 'workspaces.aiProviders.desc' })}
    >
      {aiProviderConfigs.map((p) => (
        <ProviderRow key={p.id} provider={p} available={health?.find((h) => h.id === p.id)?.available ?? null} />
      ))}
      {/* Where the OTHER kind of provider lives. Not a redirect for this page's job — a pointer, so
          someone looking for ElevenLabs or Suno stops looking here. */}
      <div className={`px-5 pb-5 text-xs text-meta leading-relaxed`}>
        {translate({ key: 'workspaces.aiProviders.mediaElsewhere' })}
      </div>
    </FormSection>
  );
}

function ProviderRow({ provider, available }: { provider: AiProviderConfig; available: boolean | null }) {
  const translate = useTranslator();
  const { saveAiProviderConfig } = useWorkspaces();

  //? Seeded from the snapshot and re-seeded when THIS provider's stored values change — keyed on the
  //? values themselves rather than on the array, which the snapshot rebuilds on every refresh.
  const seededModel = provider.model || provider.defaultModel;
  const known = provider.models.some((m) => m.id === seededModel);
  const [modelChoice, setModelChoice] = useState(known || seededModel.length === 0 ? seededModel : CUSTOM);
  const [customModel, setCustomModel] = useState(known ? '' : seededModel);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [temperature, setTemperature] = useState(provider.temperature);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const next = provider.model || provider.defaultModel;
    const isKnown = provider.models.some((m) => m.id === next);
    setModelChoice(isKnown || next.length === 0 ? next : CUSTOM);
    setCustomModel(isKnown ? '' : next);
    setBaseUrl(provider.baseUrl);
    setTemperature(provider.temperature);
    setApiKey('');
  }, [provider.model, provider.baseUrl, provider.temperature, provider.defaultModel, provider.models]);

  //? Nothing to configure for a host-installed CLI — say what makes it available instead of rendering
  //? an empty key box that cannot do anything.
  if (provider.auth === 'host-cli') {
    return (
      <SettingRow
        label={<ProviderLabel label={provider.label} available={available} />}
        help={translate({ key: `workspaces.aiProviders.how_${provider.id}` })}
        control={<StatusText available={available} />}
      />
    );
  }

  const resolvedModel = modelChoice === CUSTOM ? customModel.trim() : modelChoice;
  const modelItems = [
    ...provider.models.map((m) => ({ id: m.id, value: m.id, item: m.label })),
    { id: CUSTOM, value: CUSTOM, item: translate({ key: 'workspaces.aiProviders.customModel' }) },
  ];

  const save = (): void => {
    saveAiProviderConfig({
      providerId: provider.id,
      //? Only sent when the user typed one — an untouched field must not clear the stored credential.
      ...(apiKey.trim().length > 0 ? { apiKey: apiKey.trim() } : {}),
      model: resolvedModel,
      baseUrl: baseUrl.trim(),
      temperature: temperature.trim(),
    });
    setApiKey('');
    setSaved(true);
  };

  return (
    <>
      <SettingRow
        label={<ProviderLabel label={provider.label} available={available} />}
        help={translate({ key: `workspaces.aiProviders.how_${provider.id}` })}
        control={<StatusText available={available} />}
      />
      <SettingRow
        stacked
        label={translate({ key: 'workspaces.aiProviders.apiKey' })}
        help={provider.hasKey ? translate({ key: 'workspaces.aiProviders.keyStored' }) : translate({ key: 'workspaces.aiProviders.keyMissing' })}
        control={(
          <div className={`flex flex-col gap-2`}>
            <input
              type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
              placeholder={provider.hasKey ? '••••••••••••' : translate({ key: 'workspaces.aiProviders.keyPlaceholder' })}
              autoComplete="off" className={inputCls}
            />
            {provider.keyUrl.length > 0 && (
              <a href={provider.keyUrl} target="_blank" rel="noreferrer" className={`text-xs text-primary hover:underline inline-flex items-center gap-1 self-start`}>
                {translate({ key: 'workspaces.aiProviders.getKey' })} <Icon name="up-right-from-square" className={`text-[10px]`} />
              </a>
            )}
          </div>
        )}
      />
      <SettingRow
        label={translate({ key: 'workspaces.aiProviders.model' })}
        help={translate({ key: 'workspaces.aiProviders.modelHelp' })}
        control={(
          <div className={`flex flex-col gap-2`}>
            <Dropdown width="full" items={modelItems} value={modelItems.find((m) => m.id === modelChoice)} onChange={(it) => { setModelChoice(String(it.value)); setSaved(false); }} />
            {modelChoice === CUSTOM && (
              <input value={customModel} onChange={(e) => { setCustomModel(e.target.value); setSaved(false); }} placeholder={provider.defaultModel} className={`${inputCls} font-mono`} />
            )}
          </div>
        )}
      />
      <SettingRow
        stacked
        label={translate({ key: 'workspaces.aiProviders.baseUrl' })}
        help={translate({ key: 'workspaces.aiProviders.baseUrlHelp' })}
        control={(
          <input
            value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setSaved(false); }}
            placeholder={provider.defaultBaseUrl} className={`${inputCls} font-mono`}
          />
        )}
      />
      {provider.supportsTemperature && (
        <SettingRow
          label={translate({ key: 'workspaces.aiProviders.temperature' })}
          help={translate({ key: 'workspaces.aiProviders.temperatureHelp' })}
          control={<input type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => { setTemperature(e.target.value); setSaved(false); }} placeholder="0.0 – 2.0" className={inputCls} />}
        />
      )}
      {/* Explicit save, not autosave: a half-typed API key debounced to the server is a credential
          written wrong, and the row that reports "set" would then be lying. */}
      <div className={`px-5 pb-5 flex items-center gap-3`}>
        <WsButton icon="check" onClick={save}>{translate({ key: 'workspaces.aiProviders.save' })}</WsButton>
        {saved && <span className={`text-xs text-correct`}>{translate({ key: 'workspaces.aiProviders.saved' })}</span>}
      </div>
    </>
  );
}

function ProviderLabel({ label, available }: { label: string; available: boolean | null }) {
  return (
    <span className={`inline-flex items-center gap-2`}>
      <span className={`w-1.5 h-1.5 rounded-full ${available === null ? 'bg-muted' : (available ? 'bg-correct' : 'bg-wrong')}`} />
      {label}
    </span>
  );
}

function StatusText({ available }: { available: boolean | null }) {
  const translate = useTranslator();
  if (available === null) return <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.workspaceSettings.providerHealthLoading' })}</span>;
  return (
    <span className={`text-xs font-semibold ${available ? 'text-correct' : 'text-wrong'}`}>
      {translate({ key: available ? 'workspaces.workspaceSettings.providerReady' : 'workspaces.workspaceSettings.providerNotReady' })}
    </span>
  );
}
