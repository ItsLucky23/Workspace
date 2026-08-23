//? ADR 0007 — the connected AIs, as a list you manage rather than a form per provider.
//?
//? What this replaces, in order of how much it mattered:
//?   • Gemini and OpenAI were HARDCODED as two panels. The list is now rows, so two OpenAI models can
//?     sit side by side and a backend added on the server appears here with no UI change.
//?   • "Is this key valid?" was answered by "a key is present". Test sends one token through the real
//?     backend, which proves the key, the model name and the endpoint together.
//?   • Claude Code could be read but not connected or disconnected. It is a row like any other now;
//?     for a host-CLI backend "connect" means "use it", and Test asks the only question it can answer.
//?   • The base URL was a field. It is gone: which host answers is infrastructure, resolved on the
//?     server (with an operator env override for a proxy or a self-hosted gateway).
//?
//? Removing a connection can leave a feature routed to a backend that can no longer run, so the
//? confirm states exactly which features move and where — and the server performs that same move.
//? @adr 0007

/* eslint-disable react-refresh/only-export-components -- the section, its row and the add-form are one feature; splitting them to satisfy a dev-only fast-refresh rule buys nothing. Not route components. */
import { useCallback, useEffect, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import Dropdown from 'src/_components/dropdown/Dropdown';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import { FormSection, SettingRow } from '../_components/settings';
import { EmptyPicker } from '../_components/SetupNotice';
import { WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { AiConnection, AiProviderOption } from '../_data/types';

const inputCls = 'h-9 w-full px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

//? The escape hatch on the model picker: the catalog is a starting point, not a whitelist. A model
//? released after that file was written must not make the backend unreachable.
const CUSTOM = '__custom__';

//? P4-4 — the LIVE model list for a backend, fetched through an EXISTING connection of that backend (the
//? server reads the key from the row; nothing is sent from here). `null` = no live list (no connection
//? yet, or the host does not answer `/models`) → the static catalog list renders instead.
function useLiveModels(workspaceId: string | null, connectionId: string | undefined): { live: { id: string; label: string }[] | null; loading: boolean; refresh: () => void } {
  const [live, setLive] = useState<{ id: string; label: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (refresh: boolean): Promise<void> => {
    if (!workspaceId || connectionId === undefined) { setLive(null); return; }
    setLoading(true);
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/aiModels', version: 'v1', data: { workspaceId, connectionId, refresh } }));
    setLoading(false);
    if (error || res?.status !== 'success' || res.result.models.length === 0) { setLive(null); return; }
    setLive(res.result.models);
  }, [workspaceId, connectionId]);
  useEffect(() => { void load(false); }, [load]);
  return { live, loading, refresh: () => { void load(true); } };
}

export function AiProvidersSection() {
  const translate = useTranslator();
  const { aiConnections } = useWorkspaces();

  return (
    <>
      <FormSection title={translate({ key: 'workspaces.aiProviders.title' })} desc={translate({ key: 'workspaces.aiProviders.desc' })}>
        {aiConnections.length === 0 && (
          <div className={`px-5 pb-5`}>
            <EmptyPicker icon="robot" label={translate({ key: 'workspaces.aiProviders.noneConnected' })} />
          </div>
        )}
        {/* Grouped, because the two kinds are answerable by different questions: a subscription is
            "is it signed in on the server", an API key is "is this key valid and does this model
            exist". Mixing them in one flat list is what made the page read as key-only. */}
        {(['subscription', 'api-key'] as const).map((kind) => {
          const rows = aiConnections.filter((c) => c.kind === kind);
          if (rows.length === 0) return null;
          return (
            <div key={kind}>
              <div className={`px-5 pt-4 -mb-2 text-xs font-semibold uppercase tracking-wide text-meta`}>
                {translate({ key: `workspaces.aiProviders.kind_${kind}` })}
              </div>
              {rows.map((c) => <ConnectionRow key={c.id} connection={c} />)}
            </div>
          );
        })}
        {/* Where the OTHER kind of provider lives — a pointer, not a redirect, so nobody hunts for
            ElevenLabs on this page and nobody is sent away to configure what belongs here. */}
        <div className={`px-5 pb-5 text-xs text-meta leading-relaxed`}>{translate({ key: 'workspaces.aiProviders.mediaElsewhere' })}</div>
      </FormSection>

      <AddConnection />
    </>
  );
}

function ConnectionRow({ connection }: { connection: AiConnection }) {
  const translate = useTranslator();
  const { aiConnectionAction, aiOverrides } = useWorkspaces();
  const [busy, setBusy] = useState<'test' | 'remove' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const test = async (): Promise<void> => {
    setBusy('test');
    setResult(null);
    const res = await aiConnectionAction({ op: 'ai-connection-test', connectionId: connection.id });
    setBusy(null);
    setResult({ ok: res.ok, ...(res.error === undefined ? {} : { error: res.error }) });
  };

  const remove = (): void => {
    //? Computed here for the DIALOG; the server recomputes and performs it. Both read the same rule:
    //? a feature pinned to this backend has to go somewhere once its last connection is gone.
    const affected = aiOverrides.filter((o) => o.providerId === connection.providerId).map((o) => o.feature);
    const lines = [
      translate({ key: 'workspaces.aiProviders.removeBody', params: [{ key: 'name', value: `${connection.label}${connection.model ? ` · ${connection.model}` : ''}` }] }),
      affected.length > 0
        ? translate({ key: 'workspaces.aiProviders.removeMoves', params: [{ key: 'features', value: affected.join(', ') }] })
        : translate({ key: 'workspaces.aiProviders.removeNoMoves' }),
    ];
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.aiProviders.removeTitle' }),
      content: lines.join('\n\n'),
    }).then(async (ok) => {
      if (!ok) return;
      setBusy('remove');
      await aiConnectionAction({ op: 'ai-connection-remove', connectionId: connection.id });
      setBusy(null);
    });
  };

  return (
    <SettingRow
      label={(
        <span className={`inline-flex items-center gap-2`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connection.lastError === null && connection.verifiedAt !== null ? 'bg-correct' : (connection.lastError === null ? 'bg-muted' : 'bg-wrong')}`} />
          {connection.label}
          {connection.model.length > 0 && <span className={`font-mono text-xs text-meta`}>{connection.model}</span>}
        </span>
      )}
      help={statusLine(connection, translate)}
      control={(
        <div className={`flex items-center gap-2 justify-end flex-wrap`}>
          {result !== null && (
            <span className={`text-xs font-semibold ${result.ok ? 'text-correct' : 'text-wrong'}`}>
              {result.ok ? translate({ key: 'workspaces.aiProviders.testOk' }) : (result.error ?? translate({ key: 'workspaces.aiProviders.testFailed' }))}
            </span>
          )}
          <WsButton variant="secondary" icon="bolt" onClick={() => { void test(); }} disabled={busy !== null}>
            {translate({ key: busy === 'test' ? 'workspaces.aiProviders.testing' : 'workspaces.aiProviders.test' })}
          </WsButton>
          <WsButton variant="ghost" icon="trash" onClick={remove} disabled={busy !== null}>
            {translate({ key: 'workspaces.aiProviders.disconnect' })}
          </WsButton>
        </div>
      )}
    />
  );
}

/** What the row says under the name: verified, never tested, or the last failure. */
function statusLine(c: AiConnection, translate: ReturnType<typeof useTranslator>): string {
  if (c.lastError !== null) return translate({ key: 'workspaces.aiProviders.lastFailed', params: [{ key: 'error', value: c.lastError }] });
  if (c.verifiedAt !== null) return translate({ key: 'workspaces.aiProviders.verifiedAt', params: [{ key: 'when', value: new Date(c.verifiedAt).toLocaleString() }] });
  //? "A key is present" is NOT "it works" — say which one this is rather than implying the stronger one.
  return translate({ key: c.kind === 'subscription' ? 'workspaces.aiProviders.untestedCli' : 'workspaces.aiProviders.untested' });
}

function AddConnection() {
  const translate = useTranslator();
  const { aiProviderCatalog, aiConnections, aiConnectionAction, activeWorkspace } = useWorkspaces();
  //? NOT initialised from the catalog: the first render happens before the snapshot lands, so a
  //? lazy initial value pinned this to '' forever and the whole add-form rendered as null. The
  //? selection is DERIVED instead — an empty choice resolves to the first backend the moment the
  //? catalog arrives, and an explicit choice wins over it.
  const [providerId, setProviderId] = useState('');
  const [modelChoice, setModelChoice] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const provider: AiProviderOption | undefined = aiProviderCatalog.find((p) => p.id === providerId) ?? aiProviderCatalog[0];
  //? Labelled by kind in the picker itself, so the choice between "sign in on the server" and "paste
  //? a key" is visible BEFORE you pick, not after the form changes shape underneath you.
  const providerItems = aiProviderCatalog.map((p) => ({
    id: p.id, value: p.id,
    item: `${p.label} · ${translate({ key: `workspaces.aiProviders.kind_${p.kind}` })}`,
  }));
  //? P4-4 — borrow the key of an existing connection of this backend to list its models live; the static
  //? catalog list is the fallback, and the "other" hatch stays either way.
  const keyedConnection = aiConnections.find((c) => c.providerId === provider?.id && c.hasKey);
  const { live, loading: modelsLoading, refresh: refreshModels } = useLiveModels(activeWorkspace.id || null, keyedConnection?.id);
  const modelItems = [
    ...(live ?? provider?.models ?? []).map((m) => ({ id: m.id, value: m.id, item: m.label })),
    { id: CUSTOM, value: CUSTOM, item: translate({ key: 'workspaces.aiProviders.customModel' }) },
  ];
    //? Falls through the picker → the provider's default → nothing, and each step can legitimately be
  //? the EMPTY STRING (no choice made yet), so `||` is the right operator here, not `??`.
  const model = modelChoice === CUSTOM ? customModel.trim() : (modelChoice.length > 0 ? modelChoice : (provider?.defaultModel ?? ''));
    //? A SUBSCRIPTION backend is signed in on the host: no key to paste, no model to pick. Rendering
  //? either would be two boxes that cannot do anything — the dead end this page was full of.
  const needsKey = provider?.kind === 'api-key';

  const add = async (): Promise<void> => {
    if (!provider) return;
    setError('');
    setBusy(true);
    const res = await aiConnectionAction({
      op: 'ai-connection-add', providerId: provider.id,
      model: needsKey ? model : '',
      apiKey: needsKey ? apiKey.trim() : '',
    });
    setBusy(false);
    if (!res.ok) { setError(translate({ key: `workspaces.aiProviders.err_${res.error ?? 'unknown'}` })); return; }
    setApiKey('');
    setCustomModel('');
    setModelChoice('');
  };

  if (provider === undefined) return null;

  return (
    <FormSection title={translate({ key: 'workspaces.aiProviders.addTitle' })} desc={translate({ key: 'workspaces.aiProviders.addDesc' })}>
      <SettingRow
        label={translate({ key: 'workspaces.aiProviders.provider' })}
        control={<Dropdown width="full" items={providerItems} value={providerItems.find((p) => p.id === providerId)} onChange={(it) => { setProviderId(String(it.value)); setModelChoice(''); setError(''); }} />}
      />
      {/* A host-CLI backend has no model and no key — showing either would be two boxes that cannot
          do anything, which is the dead end this page was full of. */}
      {needsKey && (
        <>
          <SettingRow
            label={translate({ key: 'workspaces.aiProviders.model' })}
            help={translate({ key: live === null ? 'workspaces.aiProviders.modelHelp' : 'workspaces.aiProviders.modelHelpLive' })}
            control={(
              <div className={`flex flex-col gap-2`}>
                <div className={`flex items-center gap-2`}>
                  <Dropdown width="full" items={modelItems} value={modelItems.find((m) => m.id === (modelChoice || provider.defaultModel))} onChange={(it) => { setModelChoice(String(it.value)); setError(''); }} />
                  {keyedConnection !== undefined && (
                    <WsButton variant="ghost" icon="arrows-rotate" onClick={refreshModels} disabled={modelsLoading} title={translate({ key: 'workspaces.aiProviders.refreshModels' })}>
                      {translate({ key: modelsLoading ? 'workspaces.aiProviders.refreshingModels' : 'workspaces.aiProviders.refreshModels' })}
                    </WsButton>
                  )}
                </div>
                {modelChoice === CUSTOM && (
                  <input value={customModel} onChange={(e) => { setCustomModel(e.target.value); setError(''); }} placeholder={provider.defaultModel} className={`${inputCls} font-mono`} />
                )}
              </div>
            )}
          />
          <SettingRow
            stacked
            label={translate({ key: 'workspaces.aiProviders.apiKey' })}
            help={translate({ key: 'workspaces.aiProviders.keyHelp' })}
            control={(
              <div className={`flex flex-col gap-2`}>
                <input type="password" autoComplete="off" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setError(''); }} placeholder={translate({ key: 'workspaces.aiProviders.keyPlaceholder' })} className={inputCls} />
                {provider.keyUrl.length > 0 && (
                  <a href={provider.keyUrl} target="_blank" rel="noreferrer" className={`text-xs text-primary hover:underline inline-flex items-center gap-1 self-start`}>
                    {translate({ key: 'workspaces.aiProviders.getKey' })} <Icon name="up-right-from-square" className={`text-[10px]`} />
                  </a>
                )}
              </div>
            )}
          />
        </>
      )}
      {!needsKey && (
        <div className={`px-5 pt-1 text-xs text-meta leading-relaxed`}>{translate({ key: `workspaces.aiProviders.how_${provider.id}` })}</div>
      )}
      <div className={`px-5 py-4 flex items-center gap-3`}>
        <WsButton icon="plus" onClick={() => { void add(); }} disabled={busy}>{translate({ key: 'workspaces.aiProviders.connect' })}</WsButton>
        {error.length > 0 && <span className={`text-xs text-wrong`}>{error}</span>}
      </div>
    </FormSection>
  );
}
