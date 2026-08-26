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
import { FormSection, INPUT_CLS_FULL as inputCls, SettingRow } from '../_components/settings';
import { EmptyPicker, SetupNotice } from '../_components/SetupNotice';
import { WsButton } from '../_components/primitives';
import XtermTerminal, { disposeSession } from '../_components/XtermTerminal';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { AiConnection, AiProviderOption, CodingAgentConfig, CodingHarness, CodingSubscription, StageModelTier } from '../_data/types';
import { useWorkspaceTimeZone } from '../_functions/wsTime';


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

  //? Fase 5.2 — ONE page for every backend, grouped by the plane it serves. Within text, the
  //? subscription/api-key split stays (they answer different questions: "signed in on the server?"
  //? vs "is this key + model valid?"); media and embedding are key-only lists.
  const textRows = aiConnections.filter((c) => c.surface === 'text');
  return (
    <>
      <FormSection title={translate({ key: 'workspaces.aiProviders.title' })} desc={translate({ key: 'workspaces.aiProviders.desc' })}>
        {aiConnections.length === 0 && (
          <div className={`px-5 pb-5`}>
            <EmptyPicker icon="robot" label={translate({ key: 'workspaces.aiProviders.noneConnected' })} />
          </div>
        )}
        {(['subscription', 'api-key'] as const).map((kind) => {
          const rows = textRows.filter((c) => c.kind === kind);
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
        {(['media', 'embedding'] as const).map((surface) => {
          const rows = aiConnections.filter((c) => c.surface === surface);
          if (rows.length === 0) return null;
          return (
            <div key={surface}>
              <div className={`px-5 pt-4 -mb-2 text-xs font-semibold uppercase tracking-wide text-meta`}>
                {translate({ key: `workspaces.aiProviders.surface_${surface}` })}
              </div>
              {rows.map((c) => <ConnectionRow key={c.id} connection={c} />)}
            </div>
          );
        })}
        {/* The per-feature MEDIA knobs (model overrides, cheap preview, default voice) stayed with the
            content admin — only the KEYS moved here, so say so. */}
        <div className={`px-5 pb-5 text-xs text-meta leading-relaxed`}>{translate({ key: 'workspaces.aiProviders.mediaElsewhere' })}</div>
      </FormSection>

      <EmbedderSection />
      <AddConnection />
    </>
  );
}

//? Fase 5.2 — the workspace's RAG embedder, fixed here per workspace (`__ai_provider_embedding`).
//? Vectors only compare within one embedder, so switching gates existing retrieval until the code
//? index is rebuilt — the hint says so instead of letting search silently go empty.
function EmbedderSection() {
  const translate = useTranslator();
  const { aiOverrides, saveAiProvider, aiConnections } = useWorkspaces();
  const current = aiOverrides.find((o) => o.feature === 'embedding')?.providerId ?? 'default';
  const options = [
    { id: 'default', value: 'default', item: translate({ key: 'workspaces.aiProviders.embedderDefault' }) },
    { id: 'gemini-embedding', value: 'gemini-embedding', item: translate({ key: 'workspaces.aiProviders.embedderGemini' }) },
    { id: 'local-embedding', value: 'local-embedding', item: translate({ key: 'workspaces.aiProviders.embedderLocal' }) },
  ];
  const geminiKeyed = aiConnections.some((c) => c.providerId === 'gemini-embedding' && c.hasKey);
  return (
    <FormSection title={translate({ key: 'workspaces.aiProviders.embedderTitle' })} desc={translate({ key: 'workspaces.aiProviders.embedderDesc' })}>
      <SettingRow
        label={translate({ key: 'workspaces.aiProviders.embedderLabel' })}
        help={translate({ key: 'workspaces.aiProviders.embedderReindexHint' })}
        control={<Dropdown width="full" items={options} value={options.find((o) => o.id === current)} onChange={(it) => { saveAiProvider('embedding', String(it.value)); }} />}
      />
      {current === 'gemini-embedding' && !geminiKeyed && (
        <div className={`mx-5 mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning leading-relaxed`}>
          {translate({ key: 'workspaces.aiProviders.embedderNoKey' })}
        </div>
      )}
    </FormSection>
  );
}

function ConnectionRow({ connection }: { connection: AiConnection }) {
  const translate = useTranslator();
  const { aiConnectionAction, aiOverrides } = useWorkspaces();
  //? D55 — "last verified at" is a workspace fact; read it in the workspace's own zone.
  const timeZone = useWorkspaceTimeZone();
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
      help={statusLine(connection, translate, timeZone)}
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
function statusLine(c: AiConnection, translate: ReturnType<typeof useTranslator>, timeZone: string | undefined): string {
  if (c.lastError !== null) return translate({ key: 'workspaces.aiProviders.lastFailed', params: [{ key: 'error', value: c.lastError }] });
  if (c.verifiedAt !== null) return translate({ key: 'workspaces.aiProviders.verifiedAt', params: [{ key: 'when', value: new Date(c.verifiedAt).toLocaleString(undefined, { timeZone }) }] });
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

  //? Fase 5.2 — every connectable backend (text + media + embedding) in one picker. `local-embedding`
  //? is not connectable: it has no credential and no row — it is picked in the embedder section above.
  const connectable = aiProviderCatalog.filter((p) => p.id !== 'local-embedding');
  const provider: AiProviderOption | undefined = connectable.find((p) => p.id === providerId) ?? connectable[0];
  //? Labelled by kind/plane in the picker itself, so what the form will ask for is visible BEFORE you
  //? pick, not after it changes shape underneath you.
  const providerItems = connectable.map((p) => ({
    id: p.id, value: p.id,
    item: `${p.label} · ${translate({ key: p.surface === 'text' ? `workspaces.aiProviders.kind_${p.kind}` : `workspaces.aiProviders.surface_${p.surface}` })}`,
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
  //? A media backend has no per-connection model (its model choice is per-feature, in the content
  //? admin) — only text/embedding backends render the model picker.
  //? `needsKey` already narrows `provider` to non-nullish (aliased-condition narrowing).
  const showModel = needsKey && provider.surface !== 'media';

  const add = async (): Promise<void> => {
    if (!provider) return;
    setError('');
    setBusy(true);
    const res = await aiConnectionAction({
      op: 'ai-connection-add', providerId: provider.id,
      model: showModel ? model : '',
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
      {showModel && (
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
      )}
      {needsKey && (
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

/* --------------------------------------------------------------- coding agent (ADR 0322) */
//? Which subscription seat writes the CODE — the interactive agent typing in the ticket container — and
//? through which harness. Separate from the connections above: those route the product's text features;
//? this one picks the CLI in the PTY. The seat rule (Codex ⇒ pi) and the tier-model fallback live in the
//? Conductor (`normalizeCodingAgent`); this form mirrors them for immediate feedback only.

const CODING_TIERS: readonly StageModelTier[] = ['haiku', 'sonnet', 'opus'];
//? Client mirror of the server's DEFAULT_TIER_MODELS / MODEL_SUGGESTIONS (config.ts is server-only). A
//? drifted mirror is cosmetic: the Conductor normalises whatever is sent.
const CODING_TIER_DEFAULTS: Record<string, Record<StageModelTier, string>> = {
  'claude/claude-code': { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
  'claude/pi-agent': { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-5', opus: 'claude-opus-5' },
  'codex/pi-agent': { haiku: 'gpt-5.4-mini', sonnet: 'gpt-5.6-luna', opus: 'gpt-5.6-sol' },
};
const CODING_MODEL_SUGGESTIONS: Record<string, string[]> = {
  'claude/claude-code': ['opus', 'sonnet', 'haiku'],
  'claude/pi-agent': ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5'],
  'codex/pi-agent': ['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
};

export function CodingAgentSection() {
  const translate = useTranslator();
  const { codingAgent, saveCodingAgent, readiness, activeWorkspace } = useWorkspaces();
  const [draft, setDraft] = useState<CodingAgentConfig>(codingAgent);
  //? Which seat's login terminal is open inline (ADR 0324) — the server closes the PTY on exit and pings
  //? the room, so readiness flips without a manual refresh.
  const [loginSeat, setLoginSeat] = useState<'claude' | 'codex' | null>(null);
  const closeLogin = (): void => { if (loginSeat !== null) disposeSession(`seat-login:${loginSeat}`); setLoginSeat(null); };
  //? The broadcast delta is the confirmation: it replaces snap.codingAgent, which resyncs the draft.
  useEffect(() => { setDraft(codingAgent); }, [codingAgent]);

  const ready = readiness.codingAgent;
  const pair = `${draft.subscription}/${draft.harness}`;
  const suggestions = CODING_MODEL_SUGGESTIONS[pair] ?? [];

  const pickSubscription = (subscription: CodingSubscription): void => {
    //? Codex is only reachable through pi (server-enforced); switching seats resets the tier map to that
    //? pair's defaults — a Claude alias like `sonnet` means nothing to the Codex provider.
    const harness: CodingHarness = subscription === 'codex' ? 'pi-agent' : draft.harness;
    setDraft({ subscription, harness, tierModels: CODING_TIER_DEFAULTS[`${subscription}/${harness}`] ?? draft.tierModels });
  };
  const pickHarness = (harness: CodingHarness): void => {
    setDraft((d) => ({ ...d, harness, tierModels: CODING_TIER_DEFAULTS[`${d.subscription}/${harness}`] ?? d.tierModels }));
  };

  const subItems = (['claude', 'codex'] as const).map((s) => ({ id: s, value: s, item: translate({ key: `workspaces.codingAgent.sub_${s}` }) }));
  const harnessItems = (['claude-code', 'pi-agent'] as const).map((h) => ({ id: h, value: h, item: translate({ key: `workspaces.codingAgent.harness_${h}` }) }));

  //? Host-level gaps for the CURRENT draft. A missing BINARY is infra-only (the hint is the host command);
  //? a missing LOGIN carries a `login` seat — fixable from here via the seat-login terminal (ADR 0324,
  //? host-superadmin only; anyone else gets an immediate exit 126 in the terminal).
  const gaps: { key: 'needClaudeCli' | 'needPi' | 'needCodexAuth' | 'needClaudeAuth'; login?: 'claude' | 'codex' }[] = [
    ...(draft.harness === 'claude-code' && !ready.claudeCode ? [{ key: 'needClaudeCli' as const }] : []),
    ...(draft.harness === 'pi-agent' && !ready.piAgent ? [{ key: 'needPi' as const }] : []),
    ...(draft.subscription === 'claude' && draft.harness === 'claude-code' && ready.claudeCode && !ready.claudeAuth ? [{ key: 'needClaudeAuth' as const, login: 'claude' as const }] : []),
    ...(draft.subscription === 'codex' && !ready.codexAuth ? [{ key: 'needCodexAuth' as const, ...(ready.piAgent ? { login: 'codex' as const } : {}) }] : []),
  ];

  return (
    <FormSection title={translate({ key: 'workspaces.codingAgent.title' })} desc={translate({ key: 'workspaces.codingAgent.desc' })}>
      <SettingRow
        label={translate({ key: 'workspaces.codingAgent.subscription' })}
        help={translate({ key: 'workspaces.codingAgent.subscriptionHelp' })}
        control={<Dropdown width="full" items={subItems} value={subItems.find((s) => s.id === draft.subscription)} onChange={(it) => { pickSubscription(it.value as CodingSubscription); }} />}
      />
      <SettingRow
        label={translate({ key: 'workspaces.codingAgent.harness' })}
        help={translate({ key: draft.subscription === 'codex' ? 'workspaces.codingAgent.harnessForced' : 'workspaces.codingAgent.harnessHelp' })}
        control={draft.subscription === 'codex'
          ? <div className={`text-sm text-common`}>{translate({ key: 'workspaces.codingAgent.harness_pi-agent' })}</div>
          : <Dropdown width="full" items={harnessItems} value={harnessItems.find((h) => h.id === draft.harness)} onChange={(it) => { pickHarness(it.value as CodingHarness); }} />}
      />
      {/* OPEN VRAAG A — allowed but loudly warned: a Claude seat through pi bills per token as EXTRA USAGE
          on top of the plan, not against the plan's quota. */}
      {draft.subscription === 'claude' && draft.harness === 'pi-agent' && (
        <div className={`mx-5 mb-1 rounded-lg border border-wrong/40 bg-wrong/10 px-3 py-2 text-xs text-wrong leading-relaxed`}>
          {translate({ key: 'workspaces.codingAgent.piMeteredWarning' })}
        </div>
      )}
      {gaps.map((g) => (
        <div key={g.key} className={`px-5 pb-2`}>
          <SetupNotice
            variant="card"
            icon="terminal"
            title={translate({ key: `workspaces.codingAgent.${g.key}Title` })}
            body={translate({ key: `workspaces.codingAgent.${g.key}Body` })}
            hint={<span className={`font-mono`}>{translate({ key: `workspaces.codingAgent.${g.key}Hint` })}</span>}
          />
          {g.login !== undefined && loginSeat === null && (
            <div className={`pt-2`}>
              <WsButton icon="terminal" onClick={() => { setLoginSeat(g.login ?? null); }}>{translate({ key: 'workspaces.codingAgent.seatLoginCta' })}</WsButton>
            </div>
          )}
        </div>
      ))}
      {loginSeat !== null && (
        <div className={`px-5 pb-3`}>
          <div className={`rounded-xl border border-container2-border overflow-hidden`}>
            <div className={`flex items-center justify-between gap-3 bg-container2 px-3 py-2`}>
              <div className={`text-xs text-common leading-relaxed`}>{translate({ key: `workspaces.codingAgent.seatLoginHint_${loginSeat}` })}</div>
              <WsButton icon="xmark" onClick={closeLogin}>{translate({ key: 'workspaces.codingAgent.seatLoginClose' })}</WsButton>
            </div>
            <XtermTerminal sessionId={`seat-login:${loginSeat}`} workspaceId={activeWorkspace.id} seat={loginSeat} className={`h-80`} />
          </div>
        </div>
      )}
      {CODING_TIERS.map((tier) => (
        <SettingRow
          key={tier}
          label={translate({ key: `workspaces.codingAgent.tier_${tier}` })}
          help={translate({ key: `workspaces.codingAgent.tierHelp_${tier}` })}
          control={(
            <input
              value={draft.tierModels[tier]}
              onChange={(e) => { setDraft((d) => ({ ...d, tierModels: { ...d.tierModels, [tier]: e.target.value } })); }}
              placeholder={CODING_TIER_DEFAULTS[pair]?.[tier] ?? ''}
              className={`${inputCls} font-mono`}
            />
          )}
        />
      ))}
      <div className={`px-5 pt-1 text-xs text-meta leading-relaxed`}>
        {translate({ key: 'workspaces.codingAgent.suggestions' })} <span className={`font-mono`}>{suggestions.join(' · ')}</span>
      </div>
      <div className={`px-5 py-4`}>
        <WsButton icon="check" onClick={() => { saveCodingAgent(draft); }}>{translate({ key: 'workspaces.codingAgent.save' })}</WsButton>
      </div>
    </FormSection>
  );
}
