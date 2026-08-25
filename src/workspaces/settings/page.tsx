//? Workspaces — Account settings. Profile, connections, sessions, web-push and data export,
//? plus workspace-scoped developer operations. Terminal access is authorized independently
//? through the logged-in session, workspace RBAC and an exact server-derived container identity.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { i18nNotify as notify, tryCatch, useSession, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import { apiRequest } from 'src/_sockets/apiRequest';

import Icon from '../_components/Icon';
import { SectionLabel, Table, type TableColumn } from '../_components/dataDisplay';
import { Collapse } from '../_components/motion';
import { AvatarBubble, Disclosure, IconButton, InfoTip, PopMenu, Tabs, Toggle, WsButton } from '../_components/primitives';
import { useTrailSegment } from '../_components/sections';
import { EmptyPicker } from '../_components/SetupNotice';
import { FormSection, INPUT_CLS as dbInputCls, INPUT_CLS as inputCls, SettingRow } from '../_components/settings';
import { isModuleEnabled } from '../_data/modules';
import type { EnvironmentSummary, PatSummary } from '../_data/types';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import { enablePush, disablePush, hasPushSubscription } from '../_functions/pushSubscribe';
import { canInstall, isIosSafari, isStandalone, promptInstall, subscribeInstall } from '../_functions/installPrompt';
import type { SessionLayout } from '../../../config';

//? Technical code-values rendered verbatim in JSX — deliberately NOT translated (PAT scope ids,
//? a token-prefix ellipsis, the demo-account row label). Const references
//? keep them out of jsx-no-literals territory without pretending they are prose.
const PAT_SCOPE_TICKETS = ' tickets:write';
const PAT_SCOPE_CONTENT = ' content:write';
const ELLIPSIS = '…';
const DEMO_ACCOUNT_LABEL = 'demo';

//? Real session shape from `settings/listSessions` (framework auth session, not
//? [control-API] tenant data) — handle/expiry only, no device/location metadata.
interface AccountSession {
  handle: string;
  expiresInSeconds: number | null;
  isCurrent: boolean;
}

//? Gap-fix — read a workspace-export JSON file and recreate it as a NEW workspace (module-scope:
//? it touches no component state).
const importWorkspace = (file: File): void => {
  void (async () => {
    const [parseErr, bundle] = await tryCatch(async () => JSON.parse(await file.text()) as unknown);
    if (parseErr) { notify.error({ key: 'workspaces.account.importInvalid' }); return; }
    const [err, res] = await tryCatch(() => apiRequest({ name: 'workspaces/workspaceImport', version: 'v1', data: { bundle } }));
    if (err || res?.status !== 'success') { notify.error({ key: 'workspaces.account.importFailed' }); return; }
    notify.success({ key: 'workspaces.account.importDone' });
    globalThis.location.reload();
  })();
};

function Card({ title, desc, right, children }: { title: string; desc?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-base font-semibold text-title">{title}</div>
          {desc && <div className="text-sm text-muted mt-0.5">{desc}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-3 border-b border-divider last:border-0">{children}</div>;
}

//? Per-project forge connect form (ADR 0036) — pick GitLab/GitHub, enter repo + token (+ optional
//? API base) for the ACTIVE project. Rendered in the menuHandler overlay from the Connections card.
function ForgeConnectForm({ projectId, onConnect }: { projectId: string; onConnect: (input: { projectId: string; mode: 'gitlab' | 'github'; baseUrl?: string; token?: string; repoPath?: string }) => void }) {
  const translate = useTranslator();
  const [mode, setMode] = useState<'gitlab' | 'github'>('github');
  const [repoPath, setRepoPath] = useState('');
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const modeItems: DropdownItem[] = [{ id: 'github', value: 'github', item: 'GitHub' }, { id: 'gitlab', value: 'gitlab', item: 'GitLab' }];
  const submit = () => {
    onConnect({ projectId, mode, ...(repoPath.trim() ? { repoPath: repoPath.trim() } : {}), ...(token.trim() ? { token: token.trim() } : {}), ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) });
    void menuHandler.close();
  };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.account.forgeConnectTitle' })}</div>
      <span className="text-sm text-muted -mt-2">{translate({ key: 'workspaces.account.forgeConnectFor' })}</span>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-common">{translate({ key: 'workspaces.account.forgeProvider' })}</span>
        <Dropdown size="sm" width="full" items={modeItems} value={modeItems.find((it) => it.id === mode)} onChange={(it) => { setMode(it.value === 'gitlab' ? 'gitlab' : 'github'); }} />
      </div>
      <input value={repoPath} onChange={(e) => { setRepoPath(e.target.value); }} placeholder={translate({ key: 'workspaces.account.forgeRepoPathPh' })} className={inputCls} />
      <input value={token} onChange={(e) => { setToken(e.target.value); }} type="password" placeholder={translate({ key: 'workspaces.account.forgeTokenPh' })} className={inputCls} />
      <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.account.forgeBaseUrlPh' })} className={inputCls} />
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="circle-check" onClick={submit}>{translate({ key: 'workspaces.account.connect' })}</WsButton>
      </div>
    </div>
  );
}

//? X3 — API tokens (Personal Access Tokens) panel: issue (raw token shown ONCE), list (prefix + scopes), revoke.
//? Issue/revoke talk to the issuePat/revokePat `_api` routes directly (not a [control-API] op — it's
//? account state); the list itself now PRELOADS from the workspace snapshot (`pats`, PatSummary) instead
//? of a mount-time GET, so a write just calls the shared `refetch()` to pull the fresh list back in.

//? F27 — the per-environment deploy log. Read-only on purpose: rolling back is already an explicit,
//? confirmed action elsewhere. What was missing was simply the ANSWER to "which commit is live, and what
//? was live before it?" — which is also what tells you whether a rollback will help.
function DeployHistoryFold({ environments }: { environments: EnvironmentSummary[] }) {
  const translate = useTranslator();
  const withHistory = environments.filter((env) => (env.deploys ?? []).length > 0);
  if (withHistory.length === 0) return null;

  return (
    <Disclosure summary={<span className="text-xs font-semibold text-muted">{translate({ key: 'workspaces.deployHistory.title' })}</span>}>
      <div className="flex flex-col gap-2 pt-1">
        {withHistory.map((env) => (
          <div key={env.id} className="flex flex-col gap-0.5">
            <SectionLabel>{env.kind}</SectionLabel>
            {(env.deploys ?? []).map((deploy, index) => (
              <Row key={deploy.id}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${deploy.status === 'live' ? 'bg-correct' : 'bg-wrong'}`} />
                  {/* The commit is the identity of a deploy — short hash, because nobody reads 40 chars. */}
                  <span className="text-xs font-mono text-title">{deploy.commit.slice(0, 8)}</span>
                  <span className="text-xs text-muted truncate">{deploy.branch}</span>
                  {/* Naming the CURRENT one is what makes the rest of the list mean anything. */}
                  {index === 0 && <span className="text-[11px] rounded-md bg-primary/10 text-primary px-1.5 py-0.5 shrink-0">{translate({ key: 'workspaces.deployHistory.current' })}</span>}
                  {index === 1 && <span className="text-[11px] text-muted shrink-0">{translate({ key: 'workspaces.deployHistory.previous' })}</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {deploy.error !== undefined && <span className="text-xs text-wrong truncate max-w-40">{deploy.error}</span>}
                  <span className="text-xs text-muted">{new Date(deploy.at).toLocaleString()}</span>
                </span>
              </Row>
            ))}
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

//? The three settings destinations. Kept as data so the tab bar and the render stay in step, and so the
//? developer tab can simply be filtered out for a workspace that has no development module.
type SettingsTab = 'account' | 'workspace' | 'developer';
const SETTINGS_TABS: { id: SettingsTab; labelKey: string }[] = [
  { id: 'account', labelKey: 'workspaces.settingsTabs.account' },
  { id: 'workspace', labelKey: 'workspaces.settingsTabs.workspace' },
  { id: 'developer', labelKey: 'workspaces.settingsTabs.developer' },
];

//? Bytes as MB — the only unit that reads at a glance for media of this size.
const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

//? F48/F06 — the media bin + the workspace's disk footprint.
//?
//? The countdown is the point: "still here for 12 days" is the difference between a delete a user can
//? recover from and one they only discover went wrong later. Permanent deletion stays available, but it is
//? an explicit, confirmed choice — never something that happens quietly in the background.
function StoragePanel() {
  const translate = useTranslator();
  const { content, restoreTrashed, purgeTrashed } = useWorkspaces();
  //? Defaulted rather than destructured straight through: client and server do not deploy in lockstep, so a
  //? client that is newer than the server it is talking to will read a snapshot without these fields. That
  //? must render an empty bin, not take the whole settings page down with it — which is exactly what a
  //? browser pass against a still-running old server just demonstrated.
  const trash = content.trash ?? [];
  const storage = content.storage ?? { liveBytes: 0, trashBytes: 0, files: 0 };

  //? Audit finding (a11y, high): Restore/Purge used to be same-size text links side by side — a mis-tap
  //? turned an undo into a permanent delete. Restore is now a real button; Purge sits behind its own menu
  //? so reaching it takes a deliberate extra step, on top of the confirm it already had.
  const columns: TableColumn<(typeof trash)[number]>[] = [
    {
      id: 'file', header: translate({ key: 'workspaces.storage.colFile' }),
      cell: (item) => (
        <span className="flex items-center gap-2 min-w-0">
          <Icon name="trash" className="text-muted" />
          <span className="text-title truncate">{item.label}</span>
        </span>
      ),
    },
    {
      id: 'expires', header: translate({ key: 'workspaces.storage.colExpires' }),
      cell: (item) => <span className="text-warning whitespace-nowrap">{translate({ key: 'workspaces.storage.daysLeft', params: [{ key: 'days', value: String(item.daysLeft) }] })}</span>,
    },
    {
      id: 'actions', header: translate({ key: 'workspaces.backlog.actions' }), align: 'right',
      cell: (item) => (
        <div className="flex items-center justify-end gap-1">
          <IconButton icon="rotate-left" title={translate({ key: 'workspaces.storage.restore' })} onClick={() => { restoreTrashed(item.id); }} />
          <PopMenu
            ariaLabel={translate({ key: 'workspaces.storage.purge' })}
            items={[{
              label: translate({ key: 'workspaces.storage.purge' }), icon: 'trash-can', danger: true,
              onClick: () => { void menuHandler.confirm({ title: translate({ key: 'workspaces.storage.purgeConfirm' }), content: item.label }).then((ok) => { if (ok) purgeTrashed(item.id); }); },
            }]}
          />
        </div>
      ),
    },
  ];

  return (
    <Card title={translate({ key: 'workspaces.storage.title' })} desc={translate({ key: 'workspaces.storage.desc' })}>
      <Row>
        <span className="text-sm text-common">{translate({ key: 'workspaces.storage.used' })}</span>
        <span className="text-sm text-title">{mb(storage.liveBytes)} <span className="text-xs text-muted">({translate({ key: 'workspaces.storage.files', params: [{ key: 'count', value: String(storage.files) }] })})</span></span>
      </Row>
      <Row>
        <span className="text-sm text-common">{translate({ key: 'workspaces.storage.inTrash' })}</span>
        <span className="text-sm text-title">{mb(storage.trashBytes)}</span>
      </Row>

      {trash.length === 0
        ? <div className="text-xs text-muted px-1 py-1">{translate({ key: 'workspaces.storage.trashEmpty' })}</div>
        : (
          <div className="mt-2 pt-2 border-t border-divider flex flex-col gap-1.5">
            <SectionLabel count={trash.length}>{translate({ key: 'workspaces.storage.trashTitle' })}</SectionLabel>
            <Table columns={columns} rows={trash} rowKey={(item) => item.id} />
          </div>
        )}
    </Card>
  );
}

function PatPanel({ workspaceId }: { workspaceId: string }) {
  const translate = useTranslator();
  const { pats, refetch } = useWorkspaces();
  const [name, setName] = useState('');
  const [scopeTickets, setScopeTickets] = useState(true);
  const [scopeContent, setScopeContent] = useState(false);
  const [rawOnce, setRawOnce] = useState<string | null>(null);
  const issue = () => {
    const scopes = [...(scopeTickets ? ['tickets:write'] : []), ...(scopeContent ? ['content:write'] : [])];
    if (scopes.length === 0) return;
    void apiRequest({ name: 'workspaces/issuePat', version: 'v1', data: { workspaceId, name: name.trim() || 'API token', scopes, clientRequestId: globalThis.crypto.randomUUID() } }).then((r) => {
      if (r.status === 'success') { setRawOnce(r.result.token); setName(''); refetch(); }
    });
  };
  const revoke = (patId: string) => { void apiRequest({ name: 'workspaces/revokePat', version: 'v1', data: { patId } }).then(() => { refetch(); }); };

  //? Audit finding (a11y, high): the revoke text-link had no real hit area. A titled IconButton behind
  //? the same confirm dialog gives it one without adding visual weight to a token row.
  const columns: TableColumn<PatSummary>[] = [
    { id: 'name', header: translate({ key: 'workspaces.account.nameLabel' }), cell: (t) => <span className="text-title">{t.name}</span> },
    {
      id: 'token', header: translate({ key: 'workspaces.pat.colToken' }),
      cell: (t) => (
        <span className="flex items-center gap-2 min-w-0">
          <code className="text-xs text-muted font-mono">{t.prefix}{ELLIPSIS}</code>
          <span className="text-xs text-muted truncate">{t.scopes.join(', ')}</span>
        </span>
      ),
    },
    {
      id: 'actions', header: translate({ key: 'workspaces.backlog.actions' }), align: 'right',
      cell: (t) => (
        <div className="flex justify-end">
          <IconButton
            icon="trash" title={translate({ key: 'workspaces.pat.revoke' })}
            onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.pat.revoke' }), content: t.name }).then((ok) => { if (ok) revoke(t.id); }); }}
          />
        </div>
      ),
    },
  ];

  return (
    <Card title={translate({ key: 'workspaces.pat.title' })} desc={translate({ key: 'workspaces.pat.desc' })}>
      {rawOnce !== null && (
        <div className="rounded-lg border border-warning-border bg-warning/10 p-2.5 mb-2 text-xs">
          <div className="text-title font-semibold mb-1">{translate({ key: 'workspaces.pat.copyNow' })}</div>
          <code className="block bg-container2 rounded px-2 py-1 font-mono break-all text-common">{rawOnce}</code>
          <button type="button" onClick={() => { setRawOnce(null); }} className="text-muted hover:text-common mt-1 cursor-pointer">{translate({ key: 'workspaces.shell.cancel' })}</button>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap pb-3 border-b border-divider">
        <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.pat.namePh' })} className="h-8 px-2 rounded-lg border border-container1-border bg-container2/50 text-xs text-title focus:outline-none focus:border-primary flex-1 min-w-32" />
        <label className="flex items-center gap-1 text-xs text-common cursor-pointer"><input type="checkbox" checked={scopeTickets} onChange={(e) => { setScopeTickets(e.target.checked); }} />{PAT_SCOPE_TICKETS}</label>
        <label className="flex items-center gap-1 text-xs text-common cursor-pointer"><input type="checkbox" checked={scopeContent} onChange={(e) => { setScopeContent(e.target.checked); }} />{PAT_SCOPE_CONTENT}</label>
        <WsButton variant="secondary" disabled={!scopeTickets && !scopeContent} onClick={issue}>{translate({ key: 'workspaces.pat.issue' })}</WsButton>
      </div>
      <div className="pt-3">
        <Table columns={columns} rows={pats} rowKey={(t) => t.id} empty={translate({ key: 'workspaces.pat.empty' })} />
      </div>
    </Card>
  );
}

export const template = 'workspaces';

export default function AccountSettings() {
  const translate = useTranslator();
  const { currentUser, theme, activeWorkspace, activeProject, connectForge, disconnectForge, focusSetup, environments, deployEnv, teardownEnv, rollbackEnv, promoteEnv, buildArtifacts, exportBuild, services, serviceStacks, provisionServiceStack, teardownServiceStack, dbConnections, migrations, dbConnect, dbMigrateCreate, dbMigrateApply, dbIntrospect } = useWorkspaces();
  //? K1/K3 — the curated service presets (stable client-side list; each maps to a server preset key).
  const SERVICE_PRESETS = useMemo(() => [
    { key: 'postgres', label: 'PostgreSQL' }, { key: 'redis', label: 'Redis' }, { key: 'kafka', label: 'Kafka' },
    { key: 'rabbitmq', label: 'RabbitMQ' }, { key: 'elasticsearch', label: 'Elasticsearch' }, { key: 'minio', label: 'MinIO (S3)' }, { key: 'mailpit', label: 'Mailpit' },
  ], []);
  const [servicePreset, setServicePreset] = useState('postgres');
  const [composeName, setComposeName] = useState('');
  const [composeYaml, setComposeYaml] = useState('');
  //? D1/D3 — the commit to pin the demo host at (blank = follow main + auto-redeploy).
  const [pinnedCommit, setPinnedCommit] = useState('');
  //? D2/D3 — the DNS for the demo host: a chosen subdomain on the base domain, or a fully custom domain.
  const [demoSubdomain, setDemoSubdomain] = useState('');
  const [demoCustomDomain, setDemoCustomDomain] = useState('');
  //? ADR 0043 — DB panel form state (connect a database + author a migration).
  const DB_KINDS = useMemo(() => [{ key: 'postgres', label: 'PostgreSQL' }, { key: 'mysql', label: 'MySQL' }, { key: 'mongo', label: 'MongoDB' }], []);
  const [dbName, setDbName] = useState('');
  const [dbKind, setDbKind] = useState('postgres');
  const [dbUrl, setDbUrl] = useState('');
  const [dbEnvKind, setDbEnvKind] = useState('dev');
  const [migName, setMigName] = useState('');
  const [migSql, setMigSql] = useState('');
  //? Fix 2026-08-25 — the introspect reply (the table list) renders inline in the card; it used to be
  //? dropped, so the button did nothing visible.
  const [dbTables, setDbTables] = useState<{ connectionId: string; tables: string[] } | null>(null);
  const [dbIntrospectBusy, setDbIntrospectBusy] = useState<string | null>(null);
  const { session } = useSession<SessionLayout>();
  //? A1 — real web-push subscribe/unsubscribe (the toggle drives the browser subscription + the server store).
  const [push, setPush] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  //? #122 — reconcile the toggle with the actual browser subscription on mount (survives reload).
  useEffect(() => { void hasPushSubscription().then(setPush); }, []);
  //? #123 — the PWA install prompt (captured at boot) becomes available only when the browser offers it.
  const canInstallApp = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  //? B4 — an iOS browser that is not yet running as an installed PWA: no prompt event, and no push either.
  const iosNotInstalled = isIosSafari() && !isStandalone();
  //? GAP_SCAN B4 — the toggle used to snap back with NO explanation when push was unsupported, blocked or
  //? unconfigured (the most common case on iOS, where push only works from an installed PWA). Keep the
  //? reason and show it.
  const [pushProblem, setPushProblem] = useState<string | null>(null);
  const togglePush = (next: boolean) => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushProblem(null);
    void (async () => {
      if (next) {
        const r = await enablePush();
        setPush(r === 'ok');
        if (r !== 'ok') setPushProblem(r);
      } else { await disablePush(); setPush(false); }
      setPushBusy(false);
    })();
  };
  //? A3 — per-type push opt-out (default on). Persisted to User.preferences.
  const rawPrefs = session?.preferences;
  const prefRec: Record<string, unknown> = rawPrefs !== null && typeof rawPrefs === 'object' && !Array.isArray(rawPrefs) ? rawPrefs : {};
  const [pushCats, setPushCats] = useState({
    assignment: prefRec.pushOnAssignment !== false,
    automation: prefRec.pushOnAutomation !== false,
    aiSuggestion: prefRec.pushOnAiSuggestion !== false,
  });
  const savePushCat = (key: 'assignment' | 'automation' | 'aiSuggestion', prefKey: string, next: boolean) => {
    setPushCats((c) => ({ ...c, [key]: next }));
    void apiRequest({ name: 'settings/updatePreferences', version: 'v1', data: { preferences: { [prefKey]: next } } });
  };
  //? ADR 0309 — /settings is canonical for account fields (name, avatar, theme, language, sessions,
  //? 2FA). This tab shows them read-only with a link out, rather than a second editable copy.
  const languageCode = session?.language ?? 'en';
  const twoFactorEnabled = session?.twoFactorEnabled === true;
  //? Simplify: dev/ops surfaces (forge, PATs, deploy, services, DB, raw SQL) are only shown when the
  //? development module is on AND the current user is admin/owner (fail-open: an unresolved role is not 'member',
  //? so it stays visible). A plain 'member' or a content/design-only workspace sees a clean account page.
  //? Collapsed by default so even an admin's first paint stays light (progressive disclosure).
  const showDevOps = isModuleEnabled(activeWorkspace.enabledSections, 'development') && activeWorkspace.role !== 'member';
  //? ADR 0312 — the tab is the URL (`/workspaces/settings/developer`), so a "fix it" deep-link from a
  //? blocked feature is an address rather than a focus request the page has to consume and clear.
  //? Validated against the VISIBLE tabs, not all of them: a link to /settings/developer sent to someone
  //? without the developer surface must land on Account, not render an empty panel.
  const visibleTabs = SETTINGS_TABS.filter((t) => t.id !== 'developer' || showDevOps);
  const [tab, setTab] = useTrailSegment<SettingsTab>(0, visibleTabs.map((t) => t.id), 'account');

  //? Forge identity is per PROJECT (ADR 0036). Never infer it from the workspace legacy fallback
  //? or from repository-clone state: connecting forge APIs and cloning a worktree are separate steps.
  const activeForgeMode = activeProject?.forgeMode ?? (activeWorkspace.forgeType === 'github' ? 'github' : 'gitlab');
  const forgeConnected = activeProject?.forgeStatus === 'connected';
  //? #63 — the active project's declared services (monorepo units) that deploy per-service.
  const projectServices = activeProject ? services.filter((s) => s.projectId === activeProject.id) : [];

  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const refreshSessions = useCallback(() => {
    void (async () => {
      const response = await apiRequest({ name: 'settings/listSessions', version: 'v1', data: {} });
      if (response.status === 'success') setSessions(response.result.sessions);
    })();
  }, []);
  useEffect(() => { refreshSessions(); }, [refreshSessions]);

  //? Client-side export of the visible profile — no server round-trip needed.
  const exportData = () => {
    const blob = new Blob([JSON.stringify(currentUser, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `account-${currentUser.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: tab === 'account' ? 'workspaces.account.heading' : `workspaces.settingsTabs.${tab}` })}</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
          {/* Every setting used to live in ONE scroll of a dozen cards, and the developer half was folded
              behind a single "DevOps" disclosure that also hid API tokens, storage and data export — things
              a workspace without the development module still needs. Three named destinations instead: what
              is MINE, what is this WORKSPACE's, and the developer surface. */}
          <Tabs
            tabs={visibleTabs.map((t) => ({ id: t.id, label: translate({ key: t.labelKey }) }))}
            active={tab} onChange={(id) => { const found = visibleTabs.find((t) => t.id === id); if (found) setTab(found.id); }}
          />

          {tab === 'account' && (<>
          {/* ADR 0309 — one clear primary action for the whole tab: /settings owns editing these
              fields, this is a read-only summary with a single way out. */}
          <div className="rounded-2xl border border-container1-border bg-container1 shadow-xs p-5 flex items-center gap-4">
            <AvatarBubble user={currentUser} size={56} />
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-title truncate">{currentUser.name}</div>
              <div className="text-sm text-muted truncate">{currentUser.email}</div>
            </div>
            <WsButton variant="secondary" icon="up-right-from-square" className="shrink-0" onClick={() => { globalThis.location.assign('/settings'); }}>
              {translate({ key: 'workspaces.account.openFullSettings' })}
            </WsButton>
          </div>

          <FormSection title={translate({ key: 'workspaces.account.profile' })} desc={translate({ key: 'workspaces.account.summaryDesc' })}>
            <SettingRow
              label={translate({ key: 'workspaces.account.theme' })}
              control={<span className="text-sm text-title sm:text-right">{translate({ key: `workspaces.account.${theme}` })}</span>}
            />
            <SettingRow
              label={translate({ key: 'workspaces.account.language' })}
              control={<span className="text-sm text-title sm:text-right">{translate({ key: `settings.language.${languageCode}` })}</span>}
            />
            <SettingRow
              label={translate({ key: 'settings.twoFactorSection' })}
              control={<span className={`text-sm sm:text-right ${twoFactorEnabled ? 'text-correct' : 'text-muted'}`}>{translate({ key: twoFactorEnabled ? 'workspaces.account.enabled' : 'workspaces.account.off' })}</span>}
            />
            <SettingRow
              label={translate({ key: 'workspaces.account.sessionsTitle' })}
              control={<span className="text-sm text-title sm:text-right">{translate({ key: 'workspaces.account.sessionsCount', params: [{ key: 'count', value: String(sessions.length) }] })}</span>}
            />
          </FormSection>

          <FormSection title={translate({ key: 'workspaces.account.notificationsTitle' })} desc={translate({ key: 'workspaces.account.notificationsDesc' })}>
            {/* A1: real web-push — the toggle subscribes the browser + stores it server-side. */}
            <SettingRow
              label={translate({ key: 'workspaces.account.webPush' })}
              control={<Toggle on={push} onChange={togglePush} label={push ? translate({ key: 'workspaces.account.enabled' }) : translate({ key: 'workspaces.account.off' })} />}
            />
            {/* B4 — say WHY it failed instead of silently snapping back, animated instead of snapping into
                the layout (audit finding: motion). */}
            <Collapse open={pushProblem !== null}>
              <div className="px-5 pb-3 text-xs text-warning">
                {pushProblem !== null && translate({ key: `workspaces.account.push_${pushProblem}` })}
                {iosNotInstalled ? ` ${translate({ key: 'workspaces.account.pushIosHint' })}` : ''}
              </div>
            </Collapse>
            {/* B4 — iOS never fires `beforeinstallprompt`, so the in-app install button never appeared there.
                Show the manual Share → Add to Home Screen path instead. */}
            <Collapse open={iosNotInstalled}>
              <SettingRow label={translate({ key: 'workspaces.account.installApp' })} control={<span className="text-xs text-muted sm:text-right">{translate({ key: 'workspaces.account.installIos' })}</span>} />
            </Collapse>
            {/* #123 — install the PWA to the home screen (only shown when the browser offers the prompt). */}
            <Collapse open={canInstallApp}>
              <SettingRow label={translate({ key: 'workspaces.account.installApp' })} control={<WsButton variant="secondary" icon="download" onClick={() => { void promptInstall(); }}>{translate({ key: 'workspaces.account.install' })}</WsButton>} />
            </Collapse>
            {/* A3 — per-type push opt-out (only meaningful once push is enabled). */}
            <Collapse open={push}>
              <>
                <SettingRow label={translate({ key: 'workspaces.account.pushAssignment' })} control={<Toggle on={pushCats.assignment} onChange={(v) => { savePushCat('assignment', 'pushOnAssignment', v); }} ariaLabel={translate({ key: 'workspaces.account.pushAssignment' })} />} />
                <SettingRow label={translate({ key: 'workspaces.account.pushAutomation' })} control={<Toggle on={pushCats.automation} onChange={(v) => { savePushCat('automation', 'pushOnAutomation', v); }} ariaLabel={translate({ key: 'workspaces.account.pushAutomation' })} />} />
                <SettingRow label={translate({ key: 'workspaces.account.pushAiSuggestion' })} control={<Toggle on={pushCats.aiSuggestion} onChange={(v) => { savePushCat('aiSuggestion', 'pushOnAiSuggestion', v); }} ariaLabel={translate({ key: 'workspaces.account.pushAiSuggestion' })} />} />
              </>
            </Collapse>
          </FormSection>

          <FormSection title={translate({ key: 'workspaces.account.yourDataTitle' })}>
            <SettingRow
              label={translate({ key: 'workspaces.account.downloadData' })}
              control={<WsButton variant="secondary" icon="up-right-from-square" onClick={exportData}>{translate({ key: 'workspaces.account.export' })}</WsButton>}
            />
            {/* Gap-fix — import a workspace-export JSON back as a NEW workspace (there was no import path). */}
            <SettingRow
              label={translate({ key: 'workspaces.account.importWorkspace' })}
              control={(
                <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-container1-border bg-container1 hover:bg-container2 text-sm text-common cursor-pointer">
                  <Icon name="download" /> {translate({ key: 'workspaces.account.importPick' })}
                  <input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importWorkspace(f); e.target.value = ''; }} />
                </label>
              )}
            />
          </FormSection>
          </>)}

          {tab === 'workspace' && (<>
{/* X3 — API tokens (issue/list/revoke) for the public API. */}
          <PatPanel workspaceId={activeWorkspace.id} />

          {/* F48/F06 — the media BIN + what this workspace occupies on disk. Deleting media no longer
              destroys bytes immediately: it lands here with a visible countdown, so a misclick is
              recoverable and a deliberate wipe is still one click away. Storage is MEASURED, not capped. */}
          <StoragePanel />

          {/* H4 — download a tenant-scoped JSON export of the workspace (portability/backup; secrets excluded). */}
          <FormSection title={translate({ key: 'workspaces.dataExport.title' })} desc={translate({ key: 'workspaces.dataExport.desc' })}>
            <SettingRow
              label={translate({ key: 'workspaces.dataExport.hint' })}
              control={(
                <WsButton variant="secondary" icon="download" onClick={() => {
                  void apiRequest({ name: 'workspaces/workspaceExport', version: 'v1', data: { workspaceId: activeWorkspace.id } }).then((r) => {
                    if (r.status !== 'success') return;
                    const blob = new Blob([JSON.stringify(r.result, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `workspace-${activeWorkspace.id}.json`; a.click();
                    URL.revokeObjectURL(url);
                  });
                }}>{translate({ key: 'workspaces.dataExport.download' })}</WsButton>
              )}
            />
          </FormSection>
          </>)}

          {showDevOps && tab === 'developer' && (<>
<FormSection title={translate({ key: 'workspaces.account.connectionsTitle' })} desc={translate({ key: 'workspaces.account.connectionsDesc' })}>
            {/* Per-project forge connect (ADR 0036): GitLab OR GitHub for the active project. The
                label + connected badge come from the ForgeConnection snapshot, not legacy workspace
                mode or the separate repository-clone state. */}
            <SettingRow
              label={<span className="inline-flex items-center gap-2"><Icon name="diagram-project" className="text-muted" /> {translate({ key: activeForgeMode === 'github' ? 'workspaces.account.github' : 'workspaces.account.gitlab' })}{activeProject ? ` · ${activeProject.name}` : ''}</span>}
              //? The green badge says "saved", never "works" — the connect op never calls the forge back
              //? (conductor `forge-connect` writes status:'connected' unconditionally), so a typo'd token
              //? looks identical to a working one until a repo job fails.
              infoTitle={translate({ key: 'workspaces.tips.settings.forgeConnectedTitle' })}
              info={translate({ key: 'workspaces.tips.settings.forgeConnectedBody' })}
              control={(
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  {forgeConnected && <span className="inline-flex items-center gap-1 text-xs text-correct"><Icon name="circle-check" /> {translate({ key: 'workspaces.account.connected' })}</span>}
                  <WsButton variant="secondary" disabled={!activeProject} onClick={() => { if (activeProject) void menuHandler.open(<ForgeConnectForm projectId={activeProject.id} onConnect={connectForge} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); }}>{translate({ key: 'workspaces.account.connect' })}</WsButton>
                  {forgeConnected && <WsButton variant="danger" icon="xmark" onClick={() => {
                    void menuHandler.confirm({
                      title: translate({ key: 'workspaces.account.forgeDisconnect' }),
                      content: translate({ key: 'workspaces.account.forgeDisconnectConfirm' }),
                      input: activeProject.name,
                    }).then((ok) => { if (ok) disconnectForge(activeProject.id); });
                  }}>{translate({ key: 'workspaces.account.forgeDisconnect' })}</WsButton>}
                </div>
              )}
            />
            {/* Without an active project the Connect button is greyed with no reason given, while the row
                still names a provider (the legacy workspace fallback) — it reads as "not connected yet". */}
            {!activeProject && <EmptyPicker icon="diagram-project" label={translate({ key: 'workspaces.tips.settings.noProjectForge' })} />}
            {/* F-018/F-026 — the workspace Git tab links here; give it the way back. */}
            <button type="button" onClick={() => { focusSetup({ view: 'workspace', tab: 'gitlab' }); }} className="text-xs text-primary hover:text-primary-hover cursor-pointer inline-flex items-center gap-1">
              <Icon name="arrow-right-long" /> {translate({ key: 'workspaces.account.forgeWorkspaceGitLink' })}
            </button>
          </FormSection>

          {/* Environments (ADR 0037): deploy the active project to dev/staging/prod at a stable URL. */}
          <Card
            title={translate({ key: 'workspaces.account.environmentsTitle' })}
            desc={translate({ key: 'workspaces.account.environmentsDesc' })}
            //? The three things that make people deploy the wrong thing: promote ships the SOURCE env's
            //? pinned commit (promote.ts F26), prod has no Deploy at all (conductor `env.prodViaPromote`),
            //? and the CI/security gates are OPT-IN — `ciGreenForProject` returns green with zero runs and
            //? `securityBlocksProdPromote` only bites on a high/critical finding FOR that commit, so without
            //? CI no build check can refuse a promote (the source-live/known-commit health gates still do).
            //? Never let the copy imply prod is protected by default.
            right={(
              <InfoTip
                align="end"
                label={translate({ key: 'workspaces.tips.settings.envTitle' })}
                title={translate({ key: 'workspaces.tips.settings.envTitle' })}
                body={translate({ key: 'workspaces.tips.settings.envBody' })}
                points={[
                  { id: 'promote', label: translate({ key: 'workspaces.tips.settings.envPromoteLabel' }), desc: translate({ key: 'workspaces.tips.settings.envPromoteDesc' }) },
                  { id: 'prod', label: translate({ key: 'workspaces.tips.settings.envProdLabel' }), desc: translate({ key: 'workspaces.tips.settings.envProdDesc' }) },
                  { id: 'checks', label: translate({ key: 'workspaces.tips.settings.envChecksLabel' }), desc: translate({ key: 'workspaces.tips.settings.envChecksDesc' }) },
                ]}
              />
            )}
          >
            {/* Every button in this card sends the active project's id and is dropped when there is none. */}
            {!activeProject && <EmptyPicker icon="cube" label={translate({ key: 'workspaces.tips.settings.noProjectEnvs' })} />}
            {['dev', 'staging', 'prod'].map((kind) => {
              const env = environments.find((e) => e.kind === kind && e.serviceId === undefined);
              return (
                <Row key={kind}>
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-title uppercase w-16">{kind}</span>
                    {env
                      ? <span className={`inline-flex items-center gap-1 text-xs ${env.status === 'live' ? 'text-correct' : (env.status === 'error' ? 'text-wrong' : 'text-muted')}`}><span className={`w-1.5 h-1.5 rounded-full ${env.status === 'live' ? 'bg-correct' : (env.status === 'error' ? 'bg-wrong' : 'bg-muted')}`} />{env.status}{env.status === 'live' && env.url ? <a href={env.url} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1 truncate">{env.route}</a> : null}</span>
                      : <span className="text-xs text-disabled">—</span>}
                  </span>
                  {/* Audit finding (a11y, high): every row action here was a naked text link — real
                      buttons + wrapping so a thumb can hit the right one on a phone-first product. */}
                  <span className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {env?.status === 'live' && kind !== 'prod' && (
                      <WsButton variant="ghost" icon="arrow-right" onClick={() => { const toProd = kind === 'staging'; if (!toProd) { promoteEnv({ fromKind: kind }); return; } void menuHandler.confirm({ title: translate({ key: 'workspaces.account.promote' }), content: `${kind} → prod` }).then((ok) => { if (ok) promoteEnv({ fromKind: kind, approved: true }); }); }}>{translate({ key: 'workspaces.account.promote' })}</WsButton>
                    )}
                    {/* SEC7 — prod has NO direct deploy (it bypasses the approval/CI/security gates); it is only reachable via promote. */}
                    {kind !== 'prod' && <WsButton variant="secondary" disabled={!activeProject || env?.status === 'deploying'} onClick={() => { deployEnv({ kind }); }}>{translate({ key: 'workspaces.account.deploy' })}</WsButton>}
                    {/* SEC8 — teardown kills the container + route: explicit confirm first (B-23). */}
                    {/* D3 — put this environment back on its last LIVE commit (refused server-side when there is none). */}
                    {env && <WsButton variant="ghost" icon="clock-rotate-left" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.account.rollback' }), content: `${kind} — ${env.route}` }).then((ok) => { if (ok) rollbackEnv(env.id); }); }}>{translate({ key: 'workspaces.account.rollback' })}</WsButton>}
                    {env && <WsButton variant="danger" icon="trash" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.account.teardown' }), content: `${kind} — ${env.route}` }).then((ok) => { if (ok) teardownEnv(env.id); }); }}>{translate({ key: 'workspaces.account.teardown' })}</WsButton>}
                  </span>
                </Row>
              );
            })}
            {/* F27 — the deploy history was recorded from day one and never shown, so "what is running, and
                what did it replace?" could not be answered from the UI. Folded away by default: it matters
                when something breaks, not on every glance. */}
            <DeployHistoryFold environments={environments.filter((e) => e.serviceId === undefined)} />
            {/* D1/D3 — demo host: "commit X at a stable URL". Pin a commit (frozen demo) or leave blank + auto-redeploy on main. */}
            {(() => {
              const demo = environments.find((e) => e.kind === 'demo' && e.serviceId === undefined);
              return (
                <Row>
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-title uppercase w-16">{DEMO_ACCOUNT_LABEL}</span>
                    {/* Blank pin = the demo follows main on a ~60s watcher (demoWatch), a pin freezes it —
                        and a taken subdomain/domain is dropped without a word (environment.ts subFree/customFree). */}
                    <InfoTip
                      align="start"
                      label={translate({ key: 'workspaces.tips.settings.demoTitle' })}
                      title={translate({ key: 'workspaces.tips.settings.demoTitle' })}
                      body={translate({ key: 'workspaces.tips.settings.demoBody' })}
                      points={[{ id: 'dns', label: translate({ key: 'workspaces.tips.settings.demoDnsLabel' }), desc: translate({ key: 'workspaces.tips.settings.demoDnsDesc' }) }]}
                    />
                    {demo
                      ? <span className={`inline-flex items-center gap-1 text-xs ${demo.status === 'live' ? 'text-correct' : (demo.status === 'error' ? 'text-wrong' : 'text-muted')}`}><span className={`w-1.5 h-1.5 rounded-full ${demo.status === 'live' ? 'bg-correct' : (demo.status === 'error' ? 'bg-wrong' : 'bg-muted')}`} />{demo.status}{demo.status === 'live' && demo.url ? <a href={demo.url} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1 truncate">{demo.route}</a> : null}</span>
                      : <input value={pinnedCommit} onChange={(e) => { setPinnedCommit(e.target.value); }} placeholder={translate({ key: 'workspaces.account.pinCommitPh' })} className="h-8 px-2 rounded-lg border border-container1-border bg-container2/50 text-xs text-title focus:outline-none focus:border-primary w-40" />}
                  </span>
                  <span className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <WsButton variant="secondary" disabled={!activeProject || demo?.status === 'deploying'} onClick={() => { deployEnv({ kind: 'demo', ...(pinnedCommit.trim() ? { pinnedCommit: pinnedCommit.trim(), autoRedeploy: false } : { autoRedeploy: true }), ...(demoSubdomain.trim() ? { subdomain: demoSubdomain.trim() } : {}), ...(demoCustomDomain.trim() ? { customDomain: demoCustomDomain.trim() } : {}) }); }}>{translate({ key: pinnedCommit.trim() ? 'workspaces.account.pinDeploy' : 'workspaces.account.deploy' })}</WsButton>
                    {demo && <WsButton variant="danger" icon="trash" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.account.teardown' }), content: `demo — ${demo.route}` }).then((ok) => { if (ok) teardownEnv(demo.id); }); }}>{translate({ key: 'workspaces.account.teardown' })}</WsButton>}
                  </span>
                </Row>
              );
            })()}
            {/* D2/D3/D4 — choose the DNS for the demo host: a subdomain on the base domain, or a fully custom domain. */}
            <div className="flex flex-wrap items-center gap-2 px-1">
              <input value={demoSubdomain} onChange={(e) => { setDemoSubdomain(e.target.value); }} placeholder={translate({ key: 'workspaces.account.subdomainPh' })} className="h-8 px-2 rounded-lg border border-container1-border bg-container2/50 text-xs text-title focus:outline-none focus:border-primary w-40" />
              <input value={demoCustomDomain} onChange={(e) => { setDemoCustomDomain(e.target.value); }} placeholder={translate({ key: 'workspaces.account.customDomainPh' })} className="h-8 px-2 rounded-lg border border-container1-border bg-container2/50 text-xs text-title focus:outline-none focus:border-primary flex-1 min-w-48" />
            </div>
            {/* Audit finding (motion): this hint used to pop in with no transition, shoving the layout below it. */}
            <Collapse open={demoCustomDomain.trim().length > 0}>
              <div className="px-1 text-[11px] text-muted">{translate({ key: 'workspaces.account.dnsInstruction', params: [{ key: 'domain', value: demoCustomDomain.trim() }] })}</div>
            </Collapse>
            {/* #63 — per-service environments: a monorepo project's services deploy/teardown INDIVIDUALLY
                (serviceId-scoped). Only shown when the active project declares services. */}
            {/* Without services the whole block is invisible, so nothing on the page ever says that the
                parts of a monorepo can be deployed separately — or where a service is added. */}
            {activeProject && projectServices.length === 0 && (
              <div className="mt-2 pt-2 border-t border-divider">
                <EmptyPicker icon="server" label={translate({ key: 'workspaces.tips.settings.noServices' })} />
              </div>
            )}
            {projectServices.length > 0 && (
              <div className="mt-2 pt-2 border-t border-divider flex flex-col gap-1.5">
                <SectionLabel>{translate({ key: 'workspaces.account.perServiceEnvs' })}</SectionLabel>
                {projectServices.map((svc) => (
                  <div key={svc.id} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-title px-1">{svc.name}</span>
                    {['dev', 'staging'].map((kind) => {
                      const env = environments.find((e) => e.kind === kind && e.serviceId === svc.id);
                      return (
                        <Row key={`${svc.id}-${kind}`}>
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium text-muted uppercase w-16 pl-2">{kind}</span>
                            {env
                              ? <span className={`inline-flex items-center gap-1 text-xs ${env.status === 'live' ? 'text-correct' : (env.status === 'error' ? 'text-wrong' : 'text-muted')}`}><span className={`w-1.5 h-1.5 rounded-full ${env.status === 'live' ? 'bg-correct' : (env.status === 'error' ? 'bg-wrong' : 'bg-muted')}`} />{env.status}{env.status === 'live' && env.url ? <a href={env.url} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1 truncate">{env.route}</a> : null}</span>
                              : <span className="text-xs text-disabled">—</span>}
                          </span>
                          <span className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            <WsButton variant="secondary" disabled={env?.status === 'deploying'} onClick={() => { deployEnv({ kind, serviceId: svc.id }); }}>{translate({ key: 'workspaces.account.deploy' })}</WsButton>
                            {env && <WsButton variant="danger" icon="trash" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.account.teardown' }), content: `${svc.name}/${kind} — ${env.route}` }).then((ok) => { if (ok) teardownEnv(env.id); }); }}>{translate({ key: 'workspaces.account.teardown' })}</WsButton>}
                          </span>
                        </Row>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.account.buildExports' })}</span>
              {/* #62 — offer BOTH export kinds (the real prod bundle was UI-less; the button hardcoded 'image'). */}
              <div className="flex items-center gap-2">
                <WsButton variant="secondary" disabled={!activeProject} onClick={() => { exportBuild('image'); }}>{translate({ key: 'workspaces.account.exportImage' })}</WsButton>
                <WsButton variant="secondary" disabled={!activeProject} onClick={() => { exportBuild('bundle'); }}>{translate({ key: 'workspaces.account.exportBundle' })}</WsButton>
              </div>
            </Row>
            {buildArtifacts.map((b) => (
              <Row key={b.id}>
                <span className="flex items-center gap-2 text-sm text-title min-w-0"><Icon name="diagram-project" className="text-muted" /> {b.kind} <span className="text-xs text-muted">{b.status}{b.sizeBytes > 0 ? ` · ${String(Math.round(b.sizeBytes / 1_048_576))} MB` : ''}</span></span>
                <span className="flex items-center gap-2 shrink-0">
                  {/* #64 — the D4 deploy-hook outcome for this export (only shown when a hook actually fired). */}
                  {b.deployHookFired === true && <span className={`text-[11px] rounded-md px-1.5 py-0.5 ${b.deployHookOk ? 'bg-correct/10 text-correct' : 'bg-wrong/10 text-wrong'}`}>{translate({ key: b.deployHookOk ? 'workspaces.account.deployHookOk' : 'workspaces.account.deployHookFail' })}{b.deployHookStatus === undefined ? '' : ` ${String(b.deployHookStatus)}`}</span>}
                  {b.status === 'ready' && b.downloadUrl ? <a href={b.downloadUrl} className="text-xs text-primary hover:underline">{translate({ key: 'workspaces.account.download' })}</a> : <span className="text-xs text-disabled">{b.error ?? '—'}</span>}
                </span>
              </Row>
            ))}
          </Card>

          {/* K1/K3 — Services: spin up a third-party service stack (Kafka/Postgres/…) to develop/test against. */}
          <Card
            title={translate({ key: 'workspaces.services.title' })}
            desc={translate({ key: 'workspaces.services.desc' })}
            //? A provision is not only containers: conductor `service-provision` upserts the preset's OWN
            //? generic keys (DATABASE_URL, REDIS_URL, SMTP_HOST, …) as encrypted EnvVars — there is NO
            //? `SVC_<name>_` namespace anywhere in the code, so a same-named key the user already had is
            //? clobbered, and teardown (deleteMany by `serviceName`) then DELETES that row rather than
            //? restoring it. Whether a bring-your-own Compose stack writes env depends on the execution mode:
            //? none on this host's Docker, the runner's own env under `isolated-v1` (conductor.ts:4211).
            right={(
              <InfoTip
                align="end"
                label={translate({ key: 'workspaces.tips.settings.servicesTitle' })}
                title={translate({ key: 'workspaces.tips.settings.servicesTitle' })}
                body={translate({ key: 'workspaces.tips.settings.servicesBody' })}
                points={[
                  { id: 'clash', label: translate({ key: 'workspaces.tips.settings.servicesClashLabel' }), desc: translate({ key: 'workspaces.tips.settings.servicesClashDesc' }) },
                  { id: 'custom', label: translate({ key: 'workspaces.tips.settings.servicesCustomLabel' }), desc: translate({ key: 'workspaces.tips.settings.servicesCustomDesc' }) },
                ]}
              />
            )}
          >
            <Row>
              <span className="flex items-center gap-2 min-w-0">
                <Dropdown size="sm" width="full" items={SERVICE_PRESETS.map((p) => ({ id: p.key, value: p.key, item: p.label }))} value={SERVICE_PRESETS.map((p) => ({ id: p.key, value: p.key, item: p.label })).find((it) => it.id === servicePreset)} onChange={(it) => { setServicePreset(String(it.value)); }} />
              </span>
              <WsButton variant="secondary" onClick={() => { provisionServiceStack({ name: servicePreset, preset: servicePreset }); }}>{translate({ key: 'workspaces.services.provision' })}</WsButton>
            </Row>
            {/* Audit finding (motion, shared): swapped the raw <details> for the app's own Disclosure so
                this expands like every other progressive-disclosure block on the page. */}
            <Disclosure summary={<span className="text-sm font-medium text-title">{translate({ key: 'workspaces.services.customCompose' })}</span>}>
              <div className="flex flex-col gap-2">
                <div className="text-xs text-muted">{translate({ key: 'workspaces.services.isolationNote' })}</div>
                <input value={composeName} onChange={(event) => { setComposeName(event.target.value); }} placeholder={translate({ key: 'workspaces.services.namePlaceholder' })} className={`${dbInputCls} w-full`} />
                <textarea value={composeYaml} onChange={(event) => { setComposeYaml(event.target.value); }} placeholder={translate({ key: 'workspaces.services.composePlaceholder' })} rows={10} className="w-full rounded-lg border border-container1-border bg-container2/50 p-3 font-mono text-xs text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
                <div className="flex justify-end">
                  <WsButton variant="secondary" disabled={!composeName.trim() || !composeYaml.trim()} onClick={() => { provisionServiceStack({ name: composeName.trim(), compose: composeYaml }); setComposeName(''); setComposeYaml(''); }}>{translate({ key: 'workspaces.services.provisionCompose' })}</WsButton>
                </div>
              </div>
            </Disclosure>
            {serviceStacks.length === 0 && <div className="text-xs text-muted px-1 py-1">{translate({ key: 'workspaces.services.empty' })}</div>}
            {serviceStacks.map((s) => (
              <Row key={s.id}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`inline-flex items-center gap-1 text-xs ${s.status === 'running' ? 'text-correct' : (s.status === 'error' ? 'text-wrong' : 'text-muted')}`}><span className={`w-1.5 h-1.5 rounded-full ${s.status === 'running' ? 'bg-correct' : (s.status === 'error' ? 'bg-wrong' : 'bg-muted')}`} /></span>
                  <span className="text-sm font-medium text-title">{s.name}</span>
                  <span className="text-xs text-muted truncate">{s.services.join(', ')}</span>
                </span>
                <WsButton variant="danger" icon="trash" className="shrink-0" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.services.teardown' }), content: s.name }).then((ok) => { if (ok) teardownServiceStack(s.name); }); }}>{translate({ key: 'workspaces.services.teardown' })}</WsButton>
              </Row>
            ))}
          </Card>

          {/* ADR 0043 — Database: connect a user-app DB, author + apply migrations, introspect schema. */}
          <Card title={translate({ key: 'workspaces.db.title' })} desc={translate({ key: 'workspaces.db.desc' })}>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input value={dbName} onChange={(e) => { setDbName(e.target.value); }} placeholder={translate({ key: 'workspaces.db.namePh' })} className={`${dbInputCls} flex-1 min-w-32`} />
                <Dropdown size="sm" width="full" items={DB_KINDS.map((k) => ({ id: k.key, value: k.key, item: k.label }))} value={DB_KINDS.map((k) => ({ id: k.key, value: k.key, item: k.label })).find((it) => it.id === dbKind)} onChange={(it) => { setDbKind(String(it.value)); }} />
                <Dropdown size="sm" width="full" items={['dev', 'staging', 'prod'].map((k) => ({ id: k, value: k, item: k }))} value={['dev', 'staging', 'prod'].map((k) => ({ id: k, value: k, item: k })).find((it) => it.id === dbEnvKind)} onChange={(it) => { setDbEnvKind(String(it.value)); }} />
                {/* One dropdown, two writes: db-connect UPDATES the existing row for this environment
                    (conductor `db-connect` findFirst → update), and it stamps a new migration's envKind —
                    where applyMigration additionally demands a recorded rollback plan for prod. */}
                <InfoTip
                  align="end"
                  label={translate({ key: 'workspaces.tips.settings.dbEnvTitle' })}
                  title={translate({ key: 'workspaces.tips.settings.dbEnvTitle' })}
                  body={translate({ key: 'workspaces.tips.settings.dbEnvBody' })}
                  points={[
                    { id: 'replace', label: translate({ key: 'workspaces.tips.settings.dbEnvReplaceLabel' }), desc: translate({ key: 'workspaces.tips.settings.dbEnvReplaceDesc' }) },
                    { id: 'prod', label: translate({ key: 'workspaces.tips.settings.dbEnvProdLabel' }), desc: translate({ key: 'workspaces.tips.settings.dbEnvProdDesc' }) },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={dbUrl} onChange={(e) => { setDbUrl(e.target.value); }} type="password" placeholder={translate({ key: 'workspaces.db.urlPh' })} className={`${dbInputCls} flex-1 min-w-48`} />
                <WsButton variant="secondary" disabled={!dbName || !dbUrl} onClick={() => { dbConnect({ name: dbName, kind: dbKind, url: dbUrl, envKind: dbEnvKind }); setDbName(''); setDbUrl(''); }}>{translate({ key: 'workspaces.db.connect' })}</WsButton>
              </div>
            </div>
            {/* Connect is enabled without a project, but the op is dropped client-side — say so up front. */}
            {!activeProject && <EmptyPicker icon="database" label={translate({ key: 'workspaces.tips.settings.noProjectDb' })} />}
            {dbConnections.length === 0 && <div className="text-xs text-muted px-1 py-1">{translate({ key: 'workspaces.db.noConnections' })}</div>}
            {dbConnections.map((c) => (
              <Row key={c.id}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-title">{c.name}</span>
                  <span className="text-xs text-muted">{c.kind} · {c.envKind}</span>
                </span>
                <WsButton variant="ghost" icon="magnifying-glass" className="shrink-0" disabled={dbIntrospectBusy === c.id} onClick={() => { setDbIntrospectBusy(c.id); void dbIntrospect(c.id).then((r) => { setDbIntrospectBusy(null); if (r.ok) { setDbTables({ connectionId: c.id, tables: r.tables }); } else { notify.error({ key: 'workspaces.db.introspectFailed' }); } }); }}>{translate({ key: 'workspaces.db.introspect' })}</WsButton>
              </Row>
            ))}
            {dbTables && (
              <div className="rounded-lg border border-container1-border bg-container1 px-3 py-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide truncate">{translate({ key: 'workspaces.db.tablesTitle', params: [{ key: 'name', value: dbConnections.find((c) => c.id === dbTables.connectionId)?.name ?? '' }, { key: 'count', value: String(dbTables.tables.length) }] })}</span>
                  <IconButton icon="xmark" title={translate({ key: 'workspaces.db.tablesClose' })} onClick={() => { setDbTables(null); }} className="shrink-0" />
                </div>
                {dbTables.tables.length === 0
                  ? <span className="text-xs text-muted">{translate({ key: 'workspaces.db.noTables' })}</span>
                  : <div className="flex flex-wrap gap-1">{dbTables.tables.map((t) => <span key={t} className="font-mono text-xs text-common rounded bg-container2 px-1.5 py-0.5">{t}</span>)}</div>}
              </div>
            )}
            <div className="flex flex-col gap-2 mt-2 border-t border-divider pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <input value={migName} onChange={(e) => { setMigName(e.target.value); }} placeholder={translate({ key: 'workspaces.db.migNamePh' })} className={`${dbInputCls} flex-1 min-w-32`} />
                <WsButton variant="secondary" disabled={!migName || !migSql} onClick={() => { dbMigrateCreate({ name: migName, sql: migSql, envKind: dbEnvKind }); setMigName(''); setMigSql(''); }}>{translate({ key: 'workspaces.db.createMigration' })}</WsButton>
              </div>
              <textarea value={migSql} onChange={(e) => { setMigSql(e.target.value); }} placeholder={translate({ key: 'workspaces.db.sqlPh' })} rows={3} className={`${dbInputCls} h-auto py-2 font-mono text-xs`} />
            </div>
            {/* The only list in this card that rendered nothing at all when empty. */}
            {migrations.length === 0 && <EmptyPicker icon="file-lines" label={translate({ key: 'workspaces.tips.settings.noMigrations' })} />}
            {migrations.map((m) => (
              <Row key={m.id}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`inline-flex w-1.5 h-1.5 rounded-full ${m.status === 'applied' ? 'bg-correct' : (m.status === 'failed' ? 'bg-wrong' : 'bg-warning')}`} />
                  <span className="text-sm font-medium text-title">{m.name}</span>
                  <span className="text-xs text-muted">{m.envKind} · {m.status}</span>
                  {m.error && <span className="text-xs text-wrong truncate">{m.error}</span>}
                </span>
                {m.status === 'pending' && (
                  <WsButton variant="ghost" icon="play" className="shrink-0" onClick={() => { if (m.envKind === 'prod') { void menuHandler.confirm({ title: translate({ key: 'workspaces.db.applyProdConfirm' }), content: m.name }).then((ok) => { if (ok) dbMigrateApply({ migrationId: m.id, approved: true }); }); } else { dbMigrateApply({ migrationId: m.id }); } }}>{translate({ key: 'workspaces.db.apply' })}</WsButton>
                )}
              </Row>
            ))}
          </Card>

          </>)}

        </div>
      </div>
    </div>
  );
}
